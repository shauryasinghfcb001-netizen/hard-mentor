import { createHash, randomBytes, randomUUID } from "node:crypto";
import { invalidateStudentHandles, setSimulatedAccess } from "./storageGate.ts";

import { prepareFictionalDeletion, type StudentDataLayout } from "./deletion.ts";

export const DEVELOPMENT_ATTESTATION = "I am this student's parent or legal guardian and consent to storing their study data for the purposes shown.";
export const DEVELOPMENT_ATTESTATION_VERSION = "development-parent-attestation-v1";
export const DEVELOPMENT_PENDING_TTL_MS = 30 * 60_000;

type Pending = { studentId: string; binding: string; digest: string; expires: number; delivered: boolean };
export interface ConsentReceipt {
  id: string; studentId: string; noticeVersion: string; confirmedAt: number;
  attestationVersion: string; scope: "fictional-scratch-only"; simulated: true;
}
export interface SimulatedDelivery {
  send(message: { recipient: string; token: string; noticeVersion: string }): Promise<void>;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
/** Development implementation only. No email provider or real-storage grant.
 * Pending challenges/receipts are volatile. Restart invalidates both. The
 * supplied TTL exercises expiry; it does not decide production retention.
 */
export class ConsentRequests {
  private pending = new Map<string, Pending>();
  private grants = new Map<string, ConsentReceipt>();
  private lastRequest = new Map<string, number>();
  constructor(private opts: { sandbox: string; sender: SimulatedDelivery; now: () => number; ttlMs?: number; noticeVersion: string; layout?: StudentDataLayout; authenticateWithdrawal?: (credential: string) => { role: "parent" | "student"; studentId: string } | null }) {
    opts.ttlMs ??= DEVELOPMENT_PENDING_TTL_MS;
    if (opts.ttlMs > DEVELOPMENT_PENDING_TTL_MS || !Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0 || !opts.noticeVersion.trim()) throw new Error("Invalid consent configuration");
    setSimulatedAccess(opts.sandbox, id => this.valid(id));
  }
  async request(studentId: string, binding: string, recipient: string): Promise<{ requestId: string; expiresAt: number; noticeVersion: string; attestationVersion: string; attestation: string }> {
    // Only fictional reserved addresses can enter the simulated delivery lane.
    if (!/^[a-z0-9_-]{1,64}$/i.test(studentId) || !binding || !/^[^\s@]+@[^\s@]+\.invalid$/.test(recipient)) throw new Error("Fictional consent input required");
    const now = this.opts.now();
    if (now - (this.lastRequest.get(studentId) ?? -Infinity) < 60_000) throw new Error("Explicit retry is rate limited");
    this.lastRequest.set(studentId, now);
    for (const [id, p] of this.pending) if (p.studentId === studentId || p.expires <= now) this.pending.delete(id);
    const token = randomBytes(32).toString("base64url");
    const requestId = randomUUID();
    const pending = { studentId, binding, digest: digest(token), expires: now + this.opts.ttlMs!, delivered: false };
    this.pending.set(requestId, pending);
    try {
      await this.opts.sender.send({ recipient, token, noticeVersion: this.opts.noticeVersion });
      pending.delivered = true;
    } catch {
      this.pending.delete(requestId);
      throw new Error("Simulated delivery failed; storage remains locked");
    }
    return { requestId, expiresAt: pending.expires, noticeVersion: this.opts.noticeVersion, attestationVersion: DEVELOPMENT_ATTESTATION_VERSION, attestation: DEVELOPMENT_ATTESTATION };
  }
  verify(input: { studentId: string; noticeVersion: string; requestId: string; token: string; binding: string; method: string; confirmed: boolean; attestation: string; attestationVersion: string }): ConsentReceipt | null {
    const p = this.pending.get(input.requestId);
    if (!p || !p.delivered || p.expires <= this.opts.now()) { this.pending.delete(input.requestId); return null; }
    if (input.studentId !== p.studentId || input.noticeVersion !== this.opts.noticeVersion || input.method !== "POST" || input.confirmed !== true || input.attestation !== DEVELOPMENT_ATTESTATION || input.attestationVersion !== DEVELOPMENT_ATTESTATION_VERSION || input.binding !== p.binding || digest(input.token) !== p.digest) return null;
    this.pending.delete(input.requestId); // synchronous consumption before granting
    const receipt: ConsentReceipt = { id: randomUUID(), studentId: p.studentId, noticeVersion: this.opts.noticeVersion, confirmedAt: this.opts.now(), attestationVersion: DEVELOPMENT_ATTESTATION_VERSION, scope: "fictional-scratch-only", simulated: true };
    this.grants.set(p.studentId, receipt);
    return { ...receipt };
  }
  valid(studentId: string): boolean {
    return this.grants.has(studentId);
  }
  receipt(studentId: string): ConsentReceipt | null {
    const receipt = this.grants.get(studentId);
    return receipt ? { ...receipt } : null;
  }
  withdraw(studentId: string, credential: string): void {
    const actor = this.opts.authenticateWithdrawal?.(credential);
    if (!actor || actor.studentId !== studentId || !["parent", "student"].includes(actor.role)) throw new Error("Authenticated parent or student required");
    if (!this.opts.layout) throw new Error("Student data layout required for deletion");
    // Revoke immediately, including if preflight or deletion fails. No raw
    // credential, subject id or content is audited.
    this.grants.delete(studentId);
    for (const [id, p] of this.pending) if (p.studentId === studentId) this.pending.delete(id);
    invalidateStudentHandles(this.opts.sandbox, studentId);
    prepareFictionalDeletion(this.opts.sandbox, studentId, this.opts.layout)();
  }
}
