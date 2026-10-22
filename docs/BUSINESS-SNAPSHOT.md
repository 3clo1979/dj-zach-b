# Business Snapshot — inquiry and manual finance metrics

The private Studio has a read-only **Business Snapshot** destination (`/studio#snapshot`), also linked from On the Deck. It calculates aggregates from the existing authenticated `/api/manage` load. It sends no analytics request, connects no payment provider, and makes no external write. Phase 2 uses the private nullable amounts and manual financial records described in [BOOKING-FINANCES.md](./BOOKING-FINANCES.md).

## What each number means

- **Website inquiries:** saved inquiry submissions whose `createdAt` falls in the last 30 **complete** America/New_York calendar days. Today is excluded, and the comparison uses the preceding 30 complete days. These are requests, not distinct visitors or people. A zero means no saved matching records; it does not prove the website was online/tracking for the whole period.
- **Booked from these inquiries:** the same received-date cohort, filtered to its current exact `Booked` status. This is not the number of bookings confirmed during the period. Requested event dates and schedule dates never determine the inquiry cohort. Canceled/declined inquiries remain in the denominator but not the Booked numerator.
- **Inquiry → booking:** currently Booked / received inquiries in each cohort, shown as a percentage. An empty denominator displays `—`, not 0% or infinity. Both cohorts are evaluated at refresh time; the older cohort has had more time to convert. Actual status transitions are recorded only from phase 2 onward; earlier booking-confirmation dates remain unknown. This metric continues to use current status, not those later transition dates. Historical conversion cannot be reconstructed.
- **Awaiting first follow-up:** all saved, non-TEST inquiries currently marked exactly `New`, including today's inquiries. Seven-day aging counts New York calendar boundaries since receipt, not elapsed 168-hour periods. No contact log or follow-up due-date field exists; the name is a status-based reminder, not evidence a client has never been contacted. The link opens the existing New filter in Booking Desk.
- **Monthly inquiry trend:** six calendar months based on received timestamps, including the current partial month through the last refresh. Current-month bars are marked as partial and not used as a like-for-like full-month comparison. Earlier empty months mean no saved records, not verified instrumentation coverage.
- **Upcoming private bookings:** currently saved `Private booking` entries dated today or later in New York, split between `booking-<inquiry id>` entries and manually created entries. This inventory is independent of the 30-day cohorts. Public appearances, blocked dates, and past dates do not count. The established ID convention identifies linked entries even if an older source inquiry is absent.

The refresh instant is captured only after a successful authenticated data load and displayed in the snapshot. The helpers use explicit New York formatting plus calendar-label arithmetic; they do not depend on the browser/server process time zone or assume every day lasts 24 hours. A successful mutation already refreshes the same private load. A loading, failed, or expired load hides all snapshot numbers instead of retaining stale totals or fabricating zeroes.

## Data quality and TEST exclusions

Exclusions affect **only Business Snapshot**. Training records remain visible and editable in Booking Desk, Calendar, and Client Voices; no records are removed or mutated. Testimonials do not feed these metrics at all.

An inquiry is known TEST data if its trimmed name matches either of these case-insensitive rules, or its trimmed email uses the exact `example.test` domain:

1. `^TEST ONLY \d{8}-[ITE]\d+(?:\s|$)` — explicit dated training labels, such as `TEST ONLY 20261022-I1 — Alex Example`.
2. `^TEST Deployment Check$` — the known legacy deployment-check name.
3. `^[^@\s]+@example\.test$` — reserved test email domain, not suffix-lookalikes such as `example.test.evil`.

An event is excluded if its title/contact name or contact email meets the same rules, or its `booking-<id>` source inquiry is excluded. The linked rule still works if a training event's title and contact details were edited. Generic `test` substrings, names such as Testa, and ordinary email addresses containing `test` are not excluded. If all explicit markers and the linked source are deliberately erased, this phase cannot infer that a record is fictional; a durable test-record flag would require a separately approved data-model change.

`createdAt` must be a valid ISO instant with `Z` or an explicit offset, including seconds. Date-only, ambiguous local, impossible/rollover, and future timestamps are excluded from dated inquiry metrics. New-status records with such timestamps remain in the current queue with unknown age. Invalid event calendar dates are excluded from upcoming counts. Counts of these problems appear in “How these numbers work.” The helper emits aggregate counts and dates, never customer names, contact details, messages, event titles, or IDs.

## Manual financial and discovery-source metrics

- **Known agreed booking value:** sum of nonnegative integer-cent `bookedAmountCents` for currently Booked, non-TEST inquiries, across all receipt dates. Known/unknown amount coverage is shown alongside it. A recorded zero is known; NULL/omitted is unknown. This is not total business revenue or cash received. Calendar-only entries have no amounts in this release and are not silently assigned zero.
- **Recorded payments, refunds, and net received:** manual, non-voided financial records dated within the same displayed last-30-complete-day window, using their `paidOn` calendar date. This is a different cohort from inquiries received. Receipts/refunds remain included after cancellation, and rebooking does not duplicate them. Net for a window can legitimately be negative when refunds in that window exceed receipts in that window; it is not an amount due. These are not provider-verified deposits, profit, or ROI.
- **How clients found you:** counts the optional source enum in the current inquiry-received cohort. Missing/legacy source values are unknown, not “Website.” Other free-text descriptions never appear in the aggregate projection. The source is self-reported discovery, not verified marketing attribution.

Financial records tied to known TEST inquiries are excluded. Orphaned records and malformed financial values/dates are omitted with quality counts instead of being treated as valid zeroes. Payment date labels are already local calendar dates, so they are never shifted through UTC. Financial actor identities, IDs, names, contacts, and descriptions are not returned by this aggregate helper.

## What remains unavailable

- Visits, unique visitors, daily average traffic, and visitor-to-inquiry conversion: **Not connected**.
- Complete accounting, automatically reconciled payment-provider receipts, and costs: **Not connected**. Only explicitly entered amounts are used; no dollars are inferred from a Booked status.
- ROI: **Not available yet**. It requires attributed revenue and costs, not just a booking conversion percentage.

There are no pretend Connect buttons, fabricated demo metrics, credentials, or silently configured services. Connecting analytics, payment providers, and costs remains outside this release.

## Verification and release

Run `pnpm test && pnpm typecheck && pnpm build`. Focused lint is `pnpm exec eslint app/studio/business-snapshot-data.ts app/studio/business-snapshot.tsx app/studio/studio.tsx app/studio/studio-data.ts`. Tests use synthetic local fixtures only:

- Metrics in New York, Honolulu, and UTC: day/window boundaries, spring/fall DST, leap/year/month edges, statuses, empty denominators, TEST false positives/exclusions, renamed linked TEST entries, manual bookings, invalid/future dates, immutability, and no PII output.
- Actual Snapshot React output: loading/unavailable/empty/TEST-only states, all cards, missing integrations, accessible chart description, read-only follow-up/calendar anchors, and data-quality explanations.
- Actual Studio handlers: snapshot hash navigation, follow-up New filter, private-data removal after 403, and preserved existing editor/navigation recovery flows.
- Actual Studio page guard plus the existing cryptographic Access/API/public-private regression suites.

These are deterministic component/server tests, not authenticated browser visual QA. Inspect desktop/mobile layouts, tab focus, Back/Forward, refresh, and a real authorized owner session before claiming that broader verification.

Phase 2 requires the additive `0005_booking_finances.sql` migration through the existing approved deployment pipeline. No new configuration variable, dependency, integration permission, or production data backfill is required. Earlier migrations and deployment configuration remain unchanged. Publication/deployment require the owner's explicit approval; no local implementation/test step grants it.
