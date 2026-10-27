# B13 parental consent proposal — awaiting owner design approval

This is a design for review, authorized Oct 26. It does not grant consent,
implement storage permission, select a service, or authorize email. The current
product persists session data before consent and does not satisfy B13.

## Proposed flow

1. Before collecting a student profile, show what will be stored and why.
   Pending intake lives only in process memory and expires after 30 minutes or
   on restart. Disable session files, memory, quiz attempts, study-record
   writes, telemetry payloads, and Zetaris/model calls for pending sessions.
   A distress message still receives support immediately and writes nothing.
2. The parent supplies their own email through a consent screen. Do not collect
   it as a student profile field. Describe the data categories, retention,
   withdrawal, and the fact that storage has not started. Request one actual
   consent email through an owner-approved sender. No email provider is chosen
   by this proposal.
3. The email contains a single-use opaque verification link, with a 30-minute
   expiry. Opening it displays the notice; an explicit confirmation POST grants
   consent. A GET or an email scanner cannot grant it. The server binds the
   challenge to this pending session, checks expiry and single use, and prevents
   replay and session substitution. Link tokens never enter application logs.
4. After verified confirmation, create a minimal consent receipt recording
   notice version, confirmation time, grant scope and an opaque consent id.
   Only then create the student directory and persist the allowed profile.
   Session persistence, H-MEM writes, quiz history and study-record changes
   must share the same central gate. Direct CLI/API entry points must not
   bypass it. A consent receipt is separate from student study records.
5. Refusal, expiry, sender failure and server restart leave storage locked.
   Retries require an explicit request and a sending rate limit. Withdrawal
   stops future writes and starts the owner-approved retention/deletion flow;
   this proposal does not silently delete existing records.

## Decisions required before implementation

- Approve the verification-link mechanism. Email control proves access to an
  inbox; it does not establish the person's parental relationship. Decide what
  parental attestation or stronger verification is required for the intended
  demo and eventual jurisdictions. Do not infer age from a grade marker.
- Choose the approved sender and the link-hosting location. The CLI needs an
  HTTPS confirmation endpoint accessible to the parent; a local-only link is
  insufficient for a real remote parent flow. No account, service, spend,
  deployment or email is authorized here.
- Resolve the original requirement conflict: "nothing persisted before
  consent" versus durable pending sessions. Proposed default is no durable
  pending student state, and restart cancels the flow. The parent email and
  challenge also remain in memory; any sender-side delivery logs require an
  explicit retention decision.
- Approve receipt contents, retention, withdrawal and deletion semantics,
  including the distinction between revoking storage permission and a separate
  request to delete existing quiz/history records.

## Acceptance required after approval

Use fictional fixtures and an isolated scratch root for development. Test that
all pending-state paths cause zero student persistence and no external study
requests; only an explicit, valid confirmation enables storage. Check expiry,
restart, replay, link prefetch, wrong-session use, refusal, sending failure,
withdrawal and distress. A mock sender proves gate behavior only. Final B13
acceptance separately needs owner-authorized real email delivery and verified
confirmation; no simulator grant can satisfy it.
