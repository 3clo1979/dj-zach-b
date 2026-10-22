# Website testimonials and Studio moderation

This feature extends the existing Studio. It does not create a Google Business Profile, post reviews to Google, send emails, or change inquiry/booking behavior.

## Visitor and moderator flow

- `/testimonials` collects a public display name, private email, event type, original testimonial, and explicit publication permission. No rating is collected.
- Every valid new submission starts **Pending**. The server records the consent version and time. Nothing publishes automatically.
- The Studio's **Testimonials** tab shows Pending, Published, and Archived entries. Staff check the client experience and private information before publishing.
- Publish makes the original words, chosen name, and event type eligible for the public homepage's **Selected client testimonials** section. The latest 24 published entries are shown; it is explicitly a curated selection, not all customer reviews.
- Unpublish returns an entry to Pending and removes it from subsequent public reads. Archive also keeps it private. Restore returns it to Pending, requiring a separate publish decision.
- The application cannot edit the client's words. Ask the client for a corrected submission if necessary. Do not silently rewrite a quote, invent testimonials, or label unverified submissions as verified clients.
- Email, consent metadata, retry-key hashes, and moderator identities are excluded from the public API. Text is rendered as text, not HTML. Public and private API responses use `Cache-Control: no-store`.
- A separate server-generated ID is used publicly. The private retry token is never published; it cannot be recovered from a public ID to test guesses about a client's email.
- Existing tabs, private calendar entries, and inquiry workflows are unchanged.

## Publication permission version

`2026-10-22-v1` is the checkbox text:

> I give DJ Zach B permission to publish my testimonial, display name, and event type on this website. I understand it will be reviewed before publication and may not be selected.

The UI sends this version and the server requires an exact match. Update the text and version together if permission changes. An older open form is then rejected with a request to reload and review the new text. The server, not the browser, records the acceptance timestamp.

The private email is used to check or follow up on the submission, not added to a marketing list. The form offers phone/text for private feedback and removal requests. Unpublish promptly when publication permission is withdrawn. **Archiving and unpublishing do not delete personal data.** Records and audit history persist until an authorized operator removes them; review retention periodically and remove information no longer needed through a separately approved data-maintenance action. No automatic retention/deletion job or email notification is included.

## Access and consistency

- The new private API is `/api/manage/testimonials`, already within the required `/api/manage/*` Access application paths. Confirm both custom domains have those wildcard protections.
- The API independently validates the same Cloudflare Access JWT and exact two-account allowlist as the existing Studio. No auth bypass or development login was added.
- New public and private POST routes require `Origin` to exactly match the request URL origin and require JSON. This is CSRF protection, not a way to prove a human/client identity.
- Streaming body-size checks apply even when `Content-Length` is absent or false. Validation enforces field lengths, event type, a current consent version, and actual boolean consent.
- Moderation uses a compare-and-swap `expectedUpdatedAt` check. A stale browser session cannot overwrite a newer decision; it must refresh first.
- SQLite triggers append submission/status history atomically to `testimonial_audit`, including moderator identity and timestamp for status changes. The log does not copy quote text or private email. It is append-only through the application, not tamper-proof against a database administrator.
- The public form reuses a random submission token after a lost response, avoiding duplicates on a retry. A changed body with an already-used token is rejected, rather than silently changing a saved testimonial.

## Bounded spam controls: no new credentials

The release needs no new secret, paid service, or external account. It includes a honeypot and persistent D1 counters with atomic increments:

- 120 valid submission attempts per site per fixed hour.
- 10 per Cloudflare client IP per fixed hour.
- 3 per normalized email per UTC day.

Limits return HTTP 429 with `Retry-After`. Existing matching idempotent retries do not consume another quota or write another quote. Counters store daily-rotating SHA-256 fingerprints of the IP/email, not raw IP addresses. These hashes are pseudonymous abuse-control data, **not guaranteed anonymous**; guessed values could be tested. Expired counters are removed on subsequent accepted global-limit checks (not by a scheduled job). Missing client-IP headers share one bucket instead of bypassing protection.

Tradeoffs: fixed windows can allow bursts near a boundary; shared networks may share a limit; changing networks/emails can evade individual limits. The global limit deliberately bounds storage writes but a single abusive sender can temporarily exhaust it for everyone. Phone/text remains available. These controls are not CAPTCHA or verified-client identity. If abuse becomes material, authorize and configure server-validated Cloudflare Turnstile and/or an appropriate edge rule before raising limits. Never place a Turnstile secret in client code or claim it is enabled when it is not. Invitation tokens tied to actual past bookings are another optional future improvement.

## Exact additive production migration — approval required

Migration: `drizzle/0002_client_testimonials.sql`.

It adds only:

1. `testimonials` — submissions, consent, current state, private retry-key hash and timestamps.
2. `testimonial_audit` — atomic submission/status history.
3. `testimonial_rate_limits` — expiring counters.
4. Supporting indexes and `testimonial_submitted_audit` / `testimonial_moderated_audit` triggers.

There are no seed testimonials, no customer data, and no changes/deletes to the existing `inquiries` or `events` tables. The nine CREATE statements use `IF NOT EXISTS` so the matching manually applied schema can be adopted by Wrangler migration history without rewriting data. This does not repair differently defined objects; compare the existing schema before using this recovery path for another database. Triggers were authored after Drizzle generation; preserve them in future migration work.

**Do not run remote migration, deploy, or push to an auto-deploying branch until the owner approves both the schema addition and website release.** The local implementation and local tests do not authorize production writes.

After approval, using an authorized Cloudflare session for the existing account:

1. Confirm the intended source revision and `dj-zach-b` Worker/database binding in `wrangler.jsonc`. Confirm the Access team/AUD remain unchanged. Inspect the pending migrations:
   ```sh
   pnpm exec wrangler d1 migrations list dj-zach-b --remote --config wrangler.jsonc
   ```
2. Confirm only the expected additive migration is pending, and record the database recovery/bookmark information available in the existing Cloudflare account before the schema change. Stop if the target or pending history differs.
3. Apply the additive migration **before** deploying the new app:
   ```sh
   pnpm exec wrangler d1 migrations apply dj-zach-b --remote --config wrangler.jsonc
   ```
4. Run the project tests, type check, and production build, then deploy through the approved existing route:
   ```sh
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm deploy
   ```
   For the existing GitHub/Workers Builds release route, the configured deploy command is `pnpm run db:migrate && pnpm run deploy`: it applies pending migrations and then deploys. Leave that command unchanged. Wrangler records successful migrations normally, including adoption of the identical manually applied testimonial schema. Do not manually insert migration-history rows or run a second deployment.
5. Read-only production checks: `/testimonials` renders, homepage shows an honest empty/selected state, `/api/testimonials` includes only the five public fields, and anonymous/spoofed requests to both `/api/manage` and `/api/manage/testimonials` are denied on both custom domains and the Worker origin. Confirm the authorized Studio sign-in still works and existing inquiries/schedule load.
6. Test an actual submit → publish → unpublish lifecycle in production **only with separate permission for clearly identified test data**, then clean it up as authorized. Prefer a migrated local/staging database for automated tests. Never publish a fake review on the live site.

If a release has to be rolled back, restore the previous Worker deployment and leave the additive tables in place. Do not drop tables to roll back code; that would destroy submissions and requires a separate, explicit data decision.

## Verification and known environment limits

The test scripts use local databases/fixtures, not the production binding. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before a release. UI component tests are not a substitute for a real browser layout check. If browser launch is blocked in the execution environment, report that gap and complete a desktop/mobile browser review in an authorized environment before declaring visual QA complete.

References: [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Cloudflare client-IP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
