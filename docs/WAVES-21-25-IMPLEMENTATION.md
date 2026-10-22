# ADVERSE JUDGE 0.30.0 — WAVE 21–25: implementation report

22 October 2026 · development release · local pilot, NOT a published SaaS.

## Scope and delivery

JUDGE remains the original state machine: ad claim → editorial challenge → rewritten brief → independently reviewed campaign → immutable release → human-confirmed action. Version 0.30.0 adds five coherent capabilities to the real Node.js server, SQLite schema, API, and UI. The work is additive to Waves 1–20 and preserves source case ownership, evidence and reviewer constraints.

### WAVE 21 — verified accounts and recovery

- Email ownership requires a separately delivered, hashed, one-use random challenge, expiring in 30 minutes. An address typed into a form is NOT verified. Tokens are never returned from an API or persisted in plaintext.
- Verification and password-reset challenges have independent purposes. Generating a new challenge revokes previous unused challenges. Recovery rotates the password and revokes every existing session.
- Generic recovery responses avoid account enumeration. HTTP/IP limits and per-account issuing limits apply. Incorrect or previously used codes return an error.
- HTTPS mail webhook is optional; without operator-supplied transport, requests fail closed or return a deliberately generic recovery response. A delivery provider must be configured to activate real email workflows.
- `JUDGE_REQUIRE_VERIFIED_EMAIL=1` enables verified-account gating for collaborative workspace operations. It is **off by default** for compatibility with existing local pilot users. This does not create production-grade SSO or MFA.

### WAVE 22 — compare and safely restore releases

- Compare an immutable historical release against the current campaign: added, removed and unchanged channel/language creatives; source brief provenance and release revision.
- Restore is a **new campaign revision**, not resurrection of old approval or evidence. Campaign returns to `draft` and must undergo independent review again.
- If a source case is unpublished, inaccessible, stale, or an ambiguous multi-source revision, restoration is blocked.
- Ledger records the restoration with reference to the historical release. The historical release itself remains digest-verifiable.

### WAVE 23 — bounded CSV import with honest provenance

- Strict CSV format: `date,spend_minor,impressions,clicks,leads,currency,note`, with escaping/quotes, header/row limits, integer ranges, date validity, currency allowlist, and leads ≤ clicks ≤ impressions.
- Read-only preview provides row counts, totals **per currency** and SHA-256 of normalized content and target release.
- Commit requires the same digest, matching campaign revision and explicit acknowledgment that values are **human supplied**.
- Duplicate batch imports are idempotent; operations do not silently append rows twice.
- Data remains manual (`source=manual`), not a measured conversion or platform-confirmed performance event. No prediction, ROI attribution, or ad-network access is claimed.

### WAVE 24 — durable server-side partner delivery queue

- One signed release dispatch can create one persistent queue entry; retry attempts use stable `judge-<UUID>` idempotency and SHA-256/HMAC-SHA256 request headers.
- Server checks the campaign, latest approval, governance holds, emergency stop, expiry, source access, and configured HTTPS partner before sending. No browser-held partner credential.
- Accept only authenticated receiver ACK with matching idempotency key. Real advertising creation requires a **distinct authenticated partner event** through the previously implemented callback contract. HTTP 200/202 is **not** an ad-created event.
- Transient 408/429/5xx/network errors use bounded exponential backoff; permanent errors stop. Operator can run `npm run delivery:preview` and `npm run delivery:once` (manual one-shot), but **no automatic scheduler** is running.
- Mid-flight revocation is reported as uncertain — the remote party may have received the package even though JUDGE refuses to mark the dispatch redeemed. A production operations runbook must reconcile these cases.
- `integrations/push-receiver.mjs` demonstrates verification against a **real local HTTP server**. Its in-memory idempotency storage is strictly a test/reference implementation: real partners must atomically persist received keys, release IDs and ACKs, then implement a separate callback.
- Integration A–G status: **0/7 configured against real user sites**. The fixture `A` exists only in tests using an injected transport.

### WAVE 25 — operator readiness, recovery and security gates

- `npm run production:doctor` inspects SQLite, foreign keys, account verification provider, required verification mode, HMAC journal, partner readiness, outstanding queue, backup and ledger status. JSON report states `productionReady:false` and explains blockers.
- `npm run production:gates` intentionally exits nonzero while blockers remain. This is a fail-safe, not a defect.
- Backup gate now checks a recent manifest via the real `inspectBackup`: size, SHA-256, restored SQLite, event replay. The existence of a filename alone does not satisfy it.
- Diagnostic evidence can be recorded as an operator attestation, but an unkeyed digest does not certify hosting, compliance or user identity.
- User-facing operational status is restricted to the user's workspace. Global readiness details are operator-only.
- Privacy export includes challenge metadata (never the token hash), authored restoration summaries, manual CSV batches and created delivery status. Erasure removes authored new-module metadata and invalidates outdated team approval through existing cleanup logic.

## Technical and data boundaries

- Node.js ≥22.13 and native experimental `node:sqlite`; local SQLite schema version **27**, migrated in-place from version 22.
- `event_attestations` continue to support deterministic case event replay and optional HMAC. Future privileged operator history is not fully included in the case-event chain; it should not be marketed as complete immutable audit certification.
- API validates session cookie, CSRF and Origin on state-changing requests. Tenant authorization is verified server-side.
- Worker concurrency is suitable for an isolated pilot; multi-node distributed delivery, DNS rebinding defense through controlled egress, and transactional partner receipt storage must be implemented before production.

## Known launch blockers

1. No audited live platform A–G integration. Their real URLs, API contracts and ability to create/publish materials are unknown.
2. No PostgreSQL or cloud HA/replication/multi-node queue; SQLite is local pilot only.
3. No production email transport, unified cloud authentication or MFA configured.
4. No complete independent penetration test, anti-abuse/captcha, DPA/privacy certification or load test.
5. No public domain, SSL deployment, billing or live partner action confirmation.
6. Existing RU/EN/中文 localization still partial on the older screens; new UI is primarily Russian.

## Acceptance evidence

Run from project root:

```bash
npm run check
npm test
python scripts/browser-waves-21-25.py
npm run delivery:preview
npm run production:doctor
```

Do not run `npm run delivery:once` with real credentials unless operators explicitly authorized the destination and verified that the intended approved release should be transferred.
