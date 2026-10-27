import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { MeterlessFailureDetails } from '../src/llm/client.ts';
import { ZodError } from 'zod';
import { parseModelDraft } from '../src/agent/modelPlanner.ts';
import type { ProposalIssue, ValidationContext } from '../src/agent/modelSafety.ts';

/** Client-boundary facts only. Proxy token counts may be estimates; neither
 * its `stop` label nor a received envelope proves provider completion. */
export interface CompletionMetadata {
  status: 'response_received' | 'aborted' | 'request_failed';
  characterCount?: number;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'requires_review';
  tokenCounts?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function completionMetadata(body: unknown): CompletionMetadata {
  const value = body as any;
  const result: CompletionMetadata = { status: 'response_received' };
  const content = value?.choices?.[0]?.message?.content;
  if (typeof content === 'string') result.characterCount = content.length;
  const finish = value?.choices?.[0]?.finish_reason;
  if (['stop', 'length', 'tool_calls', 'content_filter', 'requires_review'].includes(finish)) result.finishReason = finish;
  const counts: NonNullable<CompletionMetadata['tokenCounts']> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const count = value?.usage?.[key];
    if (Number.isSafeInteger(count) && count >= 0) counts[key] = count;
  }
  if (Object.keys(counts).length) result.tokenCounts = counts;
  return result;
}

export interface ProposalDiagnostic {
  input: 'client_text';
  boundary: 'json' | 'schema' | 'validation' | 'unknown';
  reason?: 'empty_text' | 'json_object_missing' | 'json_object_unterminated' | 'invalid_json' | 'schema_mismatch' | 'unclassified';
  issueCodes: string[];
  schemaFields?: string[];
  schemaCodes?: ('invalid_type' | 'invalid_value' | 'too_small' | 'other')[];
  /** Counts saturate at 1000; flags are deduplicated (at most four combinations). */
  registryCounts?: { data_row: number; memory: number };
  unmatchedReferences?: { kind: 'data_row' | 'memory'; existsInOtherRegistry: boolean }[];
}

export interface FailureDiagnostic extends MeterlessFailureDetails {
  stage: 'configuration' | 'zetaris_login' | 'zetaris_query' | 'model_request' | 'proposal_validation' | 'verification_gate';
  service: 'local' | 'zetaris' | 'meterless';
  httpStatus: number | null;
  category: 'configuration_error' | 'transport_error' | 'http_error' | 'invalid_response' | 'table_missing' | 'model_error' | 'proposal_rejected' | 'verification_failed';
  transportCause?: 'timeout' | 'connection_refused' | 'connection_reset' | 'dns' | 'tls' | 'other';
  proposal?: ProposalDiagnostic;
  completion?: CompletionMetadata;
}

/** Runner-only explanation of an already-rejected client reply. Uses the SAME
 * parser/schema as validation; never changes its verdict or retains values,
 * exception messages, arbitrary paths, or Zod's received/expected payloads.
 * This identifies the app boundary, not the runtime origin of the text. */
export function proposalRejectionDiagnostic(text: string, issues: readonly ProposalIssue[], context?: Pick<ValidationContext, 'rows' | 'memories'>): FailureDiagnostic {
  const allowedCodes = ['malformed', 'unknown_topic', 'missing_evidence', 'ambiguous_evidence',
    'foreign_evidence', 'unknown_field', 'invalid_minutes', 'over_time', 'checker_rejected'];
  const proposal: ProposalDiagnostic = { input: 'client_text', boundary: 'validation',
    issueCodes: allowedCodes.filter(code => issues.some(issue => issue.code === code)) };
  try {
    // Evidence filtering does not affect schema parsing; empty context avoids
    // copying any student input into the diagnostic path.
    const draft = parseModelDraft(text, { name: '', hoursPerDay: 0, message: '', intent: 'plan',
      ranked: [], memories: [], attempt: 1, feedback: [] });
    if (context && proposal.issueCodes.includes('missing_evidence')) {
      const rows = new Set(context.rows.map(row => row.sourceRow));
      const memories = new Set(context.memories.map(memory => memory.id));
      proposal.registryCounts = { data_row: Math.min(context.rows.length, 1000), memory: Math.min(context.memories.length, 1000) };
      proposal.unmatchedReferences = [];
      for (const { ref } of draft.reasons) {
        if (ref.kind !== 'data_row' && ref.kind !== 'memory') continue;
        const own = ref.kind === 'data_row' ? rows : memories;
        const other = ref.kind === 'data_row' ? memories : rows;
        if (own.has(ref.id)) continue;
        const existsInOtherRegistry = other.has(ref.id);
        if (!proposal.unmatchedReferences.some(item => item.kind === ref.kind && item.existsInOtherRegistry === existsInOtherRegistry)) {
          proposal.unmatchedReferences.push({ kind: ref.kind, existsInOtherRegistry });
        }
      }
    }
  } catch (error) {
    if (error instanceof ZodError) {
      proposal.boundary = 'schema';
      proposal.reason = 'schema_mismatch';
      const allowedFields = ['decision', 'blocks', 'blocks[]', 'blocks[].topicId', 'blocks[].minutes',
        'blocks[].activity', 'message', 'reasons', 'reasons[]', 'reasons[].text',
        'reasons[].ref', 'reasons[].ref.kind', 'reasons[].ref.id'];
      // Wildcard indexes and a fixed path vocabulary: no ids, values or keys.
      const fields = error.issues.map(issue => issue.path.map(p => typeof p === 'number' ? '[]' : String(p))
        .join('.').replaceAll('.[]', '[]'));
      proposal.schemaFields = allowedFields.filter(field => fields.includes(field)).slice(0, 8);
      const codes = error.issues.map(issue => issue.code);
      proposal.schemaCodes = (['invalid_type', 'invalid_value', 'too_small'] as const).filter(code => codes.includes(code));
      if (codes.some(code => !['invalid_type', 'invalid_value', 'too_small'].includes(code))) proposal.schemaCodes.push('other');
    } else {
      const reason = !text.trim() ? 'empty_text' : error instanceof SyntaxError ? 'invalid_json'
        : error instanceof Error && error.message === 'no JSON object in reply' ? 'json_object_missing'
        : error instanceof Error && error.message === 'unterminated JSON object in reply' ? 'json_object_unterminated'
        : 'unclassified';
      proposal.boundary = reason === 'unclassified' ? 'unknown' : 'json';
      proposal.reason = reason;
    }
  }
  return { ...failureDiagnostic('proposal_validation', 'proposal_rejected'), proposal };
}

/** Inspect structured codes/classes only, with bounded traversal of nested causes. */
export function transportCause(error: unknown): NonNullable<FailureDiagnostic['transportCause']> {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let i = 0; i < pending.length && i < 16; i++) {
    const item = pending[i];
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    // Data descriptors avoid invoking arbitrary exception getters.
    const value = (key: string) => Object.getOwnPropertyDescriptor(item, key)?.value;
    const code = value('code');
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ABORT_ERR'].includes(code) ||
        (item instanceof Error && ['TimeoutError', 'AbortError'].includes(item.name))) return 'timeout';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'connection_reset';
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(code)) return 'dns';
    if (typeof code === 'string' && (/^ERR_(?:TLS|SSL)_/.test(code) ||
        ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))) return 'tls';
    pending.push(value('cause'));
    const errors = value('errors');
    if (Array.isArray(errors)) pending.push(...errors.slice(0, 16));
  }
  return 'other';
}

/** Only fixed vocabulary, numeric status and validated identifiers may enter a receipt. */
export function failureDiagnostic(stage: FailureDiagnostic['stage'], category: FailureDiagnostic['category'], status?: number | null): FailureDiagnostic {
  return { stage, service: stage.startsWith('zetaris_') ? 'zetaris' : stage === 'model_request' ? 'meterless' : 'local',
    httpStatus: Number.isInteger(status) && status! >= 100 && status! <= 599 ? status! : null, category };
}

export function safeFailure(value: unknown): string {
  if (typeof value !== 'string') return 'verifier_failed';
  const fixed = ['token_missing', 'local_model_unavailable', 'zetaris_login_failed', 'table_missing', 'unsafe_output_refused',
    'verification_gate_failed', 'zetaris_query_failed', 'meterless_request_failed'];
  return fixed.includes(value) || /^meterless_http_[1-5][0-9]{2}$/.test(value) ? value : 'verifier_failed';
}

/** Observe only transport metadata and fixed protocol codes. Never emit response text. */
export function diagnosticFetch(fetchImpl: typeof fetch, record: (reason: string, diagnostic?: FailureDiagnostic) => void): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const login = url.pathname === '/api/auth/login';
    const query = url.pathname === '/api/proxy/query/sql/start';
    const model = url.pathname.endsWith('/chat/completions');
    const stage = login ? 'zetaris_login' : query ? 'zetaris_query' : model ? 'model_request' : 'verification_gate';
    let response: Response;
    try { response = await fetchImpl(input, init); }
    catch (error) {
      record(login ? 'zetaris_login_failed' : query ? 'zetaris_query_failed' : model ? 'meterless_request_failed' : 'verifier_failed',
        { ...failureDiagnostic(stage, 'transport_error'), transportCause: transportCause(error) });
      // Prevent provider exception text from entering planner traces or scratch files.
      throw new Error('request_failed');
    }
    if (login) {
      const body = await response.clone().json().catch(() => null);
      if (!response.ok || typeof body?.idToken !== 'string' || !body.idToken || !Number.isInteger(body?.orgId)) record('zetaris_login_failed', failureDiagnostic(stage, response.ok ? 'invalid_response' : 'http_error', response.status));
    } else if (query && !response.ok) {
      const body = await response.clone().json().catch(() => null);
      // Unknown HTTP errors do not prove that a table is absent.
      const code = body?.code ?? body?.error?.code;
      const missing = ['TABLE_NOT_FOUND', 'table_missing', 'TABLE_OR_VIEW_NOT_FOUND'].includes(code);
      record(missing ? 'table_missing' : 'zetaris_query_failed', failureDiagnostic(stage, missing ? 'table_missing' : 'http_error', response.status));
    } else if (model && !response.ok) {
      const { meterlessFailureDetails } = await import('../src/llm/client.ts');
      const details = meterlessFailureDetails(await response.clone().json().catch(() => null));
      record(`meterless_http_${response.status}`, { ...failureDiagnostic(stage, 'http_error', response.status), ...details });
      // The model client otherwise copies response text into its error and scratch traces.
      return new Response('{}', { status: response.status });
    } else if (model || query) {
      const body = await response.clone().json().catch(() => null);
      const valid = model ? typeof body?.choices?.[0]?.message?.content === 'string'
        : Array.isArray(body?.records) && typeof body?.totalCount === 'number' && typeof body?.totalPages === 'number';
      if (!valid) record(model ? 'meterless_request_failed' : 'zetaris_query_failed', failureDiagnostic(stage, 'invalid_response', response.status));
    }
    return response;
  };
}

export function launcherFailure(evidence: string, status: number): string {
  if (status === 13) return 'unsafe_output_refused';
  try { return safeFailure(JSON.parse(evidence).error); }
  catch { return 'verifier_failed'; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let reason = 'verifier_failed';
  try { reason = launcherFailure(fs.readFileSync(process.argv[2], 'utf8'), Number(process.argv[3])); }
  catch { /* Missing evidence is a fixed failure, never a raw filesystem error. */ }
  console.log(reason);
}
