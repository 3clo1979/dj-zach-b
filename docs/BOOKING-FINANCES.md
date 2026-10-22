# Booking amounts and manual payment records

This feature keeps three different facts separate: **quoted amount**, **agreed booking amount**, and **recorded money received**. Every amount is USD. It is a lightweight private record, not a payment processor, invoicing system, accounting ledger, bank reconciliation, profit report, or tax calculation.

## Owner workflow

- The public inquiry form optionally asks **How did you find us?** Choose Google, Social media, Friend / family, Venue / vendor, Returning client, or Other. The optional Other description is limited to 160 single-line characters. Leaving this blank is valid. A website inquiry describes the submission channel, not how someone discovered the business.
- Choosing **Quote sent** offers an optional quote amount. Choosing **Booked** offers an editable agreed amount, initially using the saved agreed amount or quote. A status change can continue without entering a price. Blank/unknown and a deliberately entered `$0.00` are different.
- Booking Desk keeps the original quote, agreed amount, manual payments, refunds, and net received distinct. Recording a payment never marks an inquiry Booked automatically and marking it Booked never invents a payment.
- Record actual receipts/refunds with amount, calendar date, and method: Venmo, PayPal, Cash, Stripe, or Other. These labels do not connect those services. No charge, transfer, refund, notification, or customer message is sent.
- A mistaken receipt/refund can be **voided with a reason**, not permanently deleted. The original amount, record, actor, and correction remain in history. Enter a replacement record after correcting the mistake. An actual repayment to a customer is a refund record, not a void.
- Refunds cannot exceed active recorded receipts. Voiding a receipt is blocked if it would leave recorded refunds unsupported. Overpayments are allowed but shown as a credit/overpayment, never as a misleading negative amount due.

Only inquiry-linked bookings have these financial records. Manually added calendar-only bookings remain outside financial totals. Recording cash for those entries or migrating legacy amounts is not part of this release.

## Identity, history, and concurrency

Amounts and financial records belong to the permanent inquiry ID. They do not belong to `booking-<inquiry id>`, the calendar entry that is removed when a booking is canceled. Canceling/rebooking therefore preserves financial history and never duplicates the recorded receipts. Calendar-private notes and contacts retain the existing removal warning and version checks; those event details are not copied into financial records.

Actual status transitions are timestamped from this release onward. Existing booking dates/status history are **not recorded** and are not reconstructed from inquiry receipt dates, event dates, migration time, or repeat selection of Booked. Rebooking is another status transition, not a new receipt.

Financial/status edits require the displayed inquiry revision, with atomic compare-and-swap checks. Stale work returns a conflict instead of overwriting another owner's update. The Studio preserves unsaved drafts where safe and requires review/reload after a conflict. A stable client-generated record ID makes an identical payment submission retry idempotent; reusing it with different content is rejected. An uncertain response must first be checked by a read-only refresh, not automatically resubmitted.

## Validation and privacy

Amounts are parsed from decimal strings into integer cents. Negative values, scientific notation, non-finite values, currency symbols, and more than two decimal places are rejected. Quotes/agreed amounts may be zero or unknown; payment/refund entries must be positive. The per-entry ceiling is $999,999.99. Calendar dates are validated independently of browser time zone. Payment dates cannot be in the future in America/New_York.

All amounts, receipt history, actor identities, referral descriptions, and status history remain behind the existing signed Cloudflare Access manager allowlist. Mutations also require the exact allowed origin. Management responses are private/no-store. The public events API retains its explicit safe field projection; neither calendar downloads nor public pages gain financial fields. No new credential, bank detail, card number, integration, third-party analytics event, or dependency is needed. Do not enter sensitive payment credentials in free-text fields.

## Snapshot definitions

The Snapshot labels agreed value as the **sum of known amounts for currently Booked inquiries**, with known/unknown coverage. It is not total sales or cash received. `$0.00` counts as a known amount; an omitted amount does not. Canceled inquiries are excluded from this current-booked value but their actual recorded receipts/refunds remain in received-money metrics.

Receipt metrics use the manually entered receipt/refund calendar date within the displayed complete New York day window, independently of inquiry receipt cohorts. Voided records do not contribute. TEST inquiries and their linked financial records are excluded using the existing narrow markers; no substring-based exclusion is introduced. Calendar-only bookings have no financial amounts in this release. All received totals are manually recorded and not verified with payment providers. Costs, profit, ROI, website visits, and visitor-to-inquiry conversion remain unavailable.

## Migration and release boundary

`0005_booking_finances.sql` is additive: nullable inquiry referral/amount fields, an inquiry revision, and empty history/audit/financial-record tables. Existing inquiry/event/contact/message/photo data is not rewritten, and historical sources, amounts, receipts, or booking times are not fabricated. Local tests apply it only to isolated synthetic SQLite databases.

**Approval is required before publication, remote migration, or deployment.** Do not run manual production SQL. The existing authorized deployment pipeline is `pnpm run db:migrate && pnpm run deploy` after the build. Migrate before the new Worker serves requests. Existing Studio tabs must reload after release; old status requests without the inquiry revision fail safely.

After approval: verify the exact published commit and Cloudflare build, anonymous denial at all Studio/management endpoints, unchanged public projections, and authorized desktop/mobile form/dialog workflows. Do not create real customer writes or production test receipts merely to validate deployment. Keep the additive columns/tables and their history during any Worker rollback; do not drop financial records. A pre-phase-2 Worker cannot safely continue unversioned status changes after the migration: audit constraints reject such writes. Restore a compatible phase-2 Worker before reopening management edits; do not disable audit constraints as a rollback shortcut.
