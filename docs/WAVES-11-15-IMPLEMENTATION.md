# ADVERSE JUDGE 0.20.0 — Five engineering waves (11–15)

## Product boundary
This is a **tested local SQLite pilot**. Do not market it as a production SaaS, a legal advertising review, a verified A/B-test, or a connected media-buying platform. No external platform A–G has been connected: `config/platforms.json` still lists seven clipboard-only placeholders. Test-partner HTTP conformance is a contract test, not live deployment.

### Existing journey preserved
Claim → hearing → verdict → shared workspace → evidence → two-person editorial approval → immutable JSON release (SHA-256). Existing user sessions, research votes, event-chain attestations, campaign packages and permissions are migrated non-destructively from schema 12 to 17.

## Wave 11 — Brand Library / governable copy constraints

- `brand_kits` stores a named brand voice, up to 12 forbidden and 12 required expressions, revision and workspace scope.
- Creation/change requires **workspace owner**. Read access requires membership.
- Assigning a brand to a campaign requires reviewer/owner and the expected campaign revision.
- Brand updates bump *each assigned campaign* revision and invalidate current editorial approval and cached quality run.
- Rules are deterministic **substring checks**, not a compliance engine. They can flag harmless text and miss synonyms.
- No browser-side secret; brand rules are team-visible, not publicly indexed.

## Wave 12 — Locale/channel coverage contract

- `campaign_targets` stores the explicit set of channel × language pairs (search/social/email × RU/EN/ZH).
- Repeated/unknown pairs are rejected, maximum nine pairs; storage is server-owned and version checked.
- If a target has no creative, independent review is blocked with a descriptive `MISSING_TARGET` code.
- No false automatic translation is claimed. Creatives are authored and saved by a human.
- Campaigns without explicit targets retain the former 0.15 rules, for backward compatibility.

## Wave 13 — Reproducible Creative QA

- `POST /api/ops/campaigns/:id/audit` creates a server-side snapshot for current campaign revision.
- Uses brand required/forbidden terms, target coverage, duplicate text and heuristic high-risk absolute promises.
- Each run saves SHA-256 fingerprint of the campaign revision, creatives, brand revision, and language targets.
- Report is idempotent within one revision; mutation requires a new revision + new run.
- Brand- or target-governed campaigns require a passing run before review/approval/release.
- `warning` findings never imply automatic rejection; `blocker` findings do.
- The audit does NOT prove legality, factual accuracy, delivery success or commercial effectiveness.

## Wave 14 — Authenticated release dispatch

- `release_dispatches` binds a **current approved immutable release** and a specific platform ID.
- A server HMAC token is issued for 60 minutes with explicit human consent. The database stores only its SHA-256 hash.
- Each platform needs a contract-ready manifest and its own server credential; no token is issued for unconfigured A–G.
- The partner fetches by `POST /api/integrations/release-redeem` with a stable requestId; loss of an HTTP response permits only a bounded retry with the SAME requestId within five minutes.
- `POST /api/integrations/release-events` confirms a contracted `action` using an authenticated bearer credential + unique eventId, and enforces idempotency.
- States: `issued` → `redeemed` → `confirmed`; `issued` may also be `revoked`. Redeemed data cannot be recalled from the partner.
- A stale campaign, revoked source sharing or mismatched token aborts redeem; no server-side automatic outbound connection occurs.
- A user downloading an exported JSON release is **not** a confirmed delivery.
- A malicious or untrustworthy partner cannot be authenticated by cryptography alone: operating controls and audits are still necessary.

Example server-side partner request (illustrative; fake values):

```http
POST /api/integrations/release-redeem
Authorization: Bearer <PARTNER_SERVER_SECRET>
Content-Type: application/json

{"platformId":"A","token":"<SIGNED_RELEASE_TOKEN>","requestId":"delivery-unique-00001"}
```

The partner confirms only after performing its genuine business action:

```http
POST /api/integrations/release-events
Authorization: Bearer <PARTNER_SERVER_SECRET>
Content-Type: application/json

{"platformId":"A","dispatchId":"<UUID>","eventId":"asset-creation-unique-id","action":"asset_created"}
```

## Wave 15 — Provenance-labelled observations

- `campaign_observations` records a release reference, date, currency, amounts in minor units, impressions, clicks, leads, source and explanation.
- UI recording uses **manual** as source, and observations are always marked unverified. No partner-supplied metrics are invented.
- Validation prevents negative/fractional counts, leads > clicks and clicks > impressions; the upper limit bounds abuse.
- Aggregates are separated by currency; CTR and cost per lead are simple arithmetic on declared inputs, not causal attribution.
- Wrong observations are **retracted**, not silently edited; new corrected records are appended. Aggregates exclude retracted rows.
- The source note is personal/business data: a user's authored records are removed from the active DB upon account deletion; the event log avoids retaining their free-text reasons.

## Database and authorization

SQLite schema version **17** adds `brand_kits`, `campaign_brand`, `campaign_targets`, `campaign_quality_runs`, `release_dispatches`, `dispatch_receipts`, `campaign_observations`, and `advanced_events`. Existing tables are not renamed/dropped. The pilot uses server-side workspace permission checks, session cookie + CSRF, input bounds, strict Host and Origin checks. Direct integration endpoints require a separate bearer secret. This does **not** replace SSO, MFA, verified email, anti-bot infrastructure or PostgreSQL RLS for a global deployment.

## API additions

| Operation | Method / route | Access |
|---|---|---|
| Brands list | `GET /api/ops/workspaces/:wid/brands` | Workspace member |
| Create/update brand | `POST /api/ops/workspaces/:wid/brands` | Owner |
| Ops dashboard | `GET /api/ops/campaigns/:cid` | Workspace member |
| Assign brand | `POST /api/ops/campaigns/:cid/brand` | Reviewer or owner, revision checked |
| Set target pairs | `POST /api/ops/campaigns/:cid/targets` | Reviewer or owner, revision checked |
| Run QA | `POST /api/ops/campaigns/:cid/audit` | Reviewer or owner |
| Issue handoff | `POST /api/ops/campaigns/:cid/dispatch` | Reviewer or owner, configured platform, current release, consent |
| Revoke unclaimed handoff | `POST /api/ops/campaigns/:cid/dispatch-revoke` | Reviewer or owner |
| Add manual measurement | `POST /api/ops/campaigns/:cid/observation` | Reviewer or owner, existing release |
| Retract measurement | `POST /api/ops/campaigns/:cid/observation-retract` | Reviewer or owner, reason required |
| Partner redeem | `POST /api/integrations/release-redeem` | Server-side bearer credential |
| Partner receipt | `POST /api/integrations/release-events` | Server-side bearer credential |

## Failure modes that are deliberately blocked

- An unrelated team accessing someone else's brands or campaign observations.
- Viewers modifying target language agreements, or editors changing workspace-wide brand policy.
- Reusing an old campaign revision in write calls.
- Brand updates inheriting a stale editorial approval.
- Review/release before fulfilling selected locale coverage or the current quality gate.
- Release dispatch for an outdated or unapproved release; generating tokens for unconfigured sites.
- Redeeming a signed token using another platform's credential, a new idempotency key, or after revocation.
- Reusing a confirmation event ID for another dispatch, or confirming a dispatch twice.
- Reporting manual metrics as verified partner metrics or inferring ROI.

## Operator rollout

1. Back up SQLite and read `docs/UPGRADE-V015-TO-V020-RU.md` before replacing binaries.
2. Upgrade in private staging, verify `/api/ready`, `npm test`, `npm run verify` and role restrictions.
3. Create one brand, attach to a sample campaign, set required targets, run QA, obtain independent approval and export the release.
4. Configure one real platform **only after** obtaining its validated HTTPS endpoint, scope and credential contract.
5. Exercise signed delivery + genuine external event acknowledgement with replay, expired-token and revoke scenarios. No live publishing otherwise.
6. Before public launch address the open production gates: verified identity, MFA, backups, monitoring, regulatory/DSAR workflows, spam defenses and scalability testing.
