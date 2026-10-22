# Private event details

Open a saved date in **Studio → Calendar**, then choose **Edit private details**.
The event card keeps the practical plan together:

- **Services & what I’m bringing:** a simple multiline plan, not an inventory or checklist system.
- **Notes & special requests:** the existing private notes, with room for setup instructions and additional contacts.
- **Primary contact, contact email, contact phone:** independent event-level values.

The same optional fields are available when adding a date. Editing these fields does not change the event's date, venue, public visibility, inquiry, or booking status. Email/phone links only open the owner's chosen app; Studio does not send messages or place calls automatically. Phone extensions/instructions remain readable rather than being concatenated into an incorrect dialed number.

## Inquiry defaults and existing records

Marking an inquiry **Booked** prefills a newly created private event from its services, message, and contact details. The existing insert-on-conflict-do-nothing behavior is retained: clicking Booked again never overwrites a saved event plan.

Migration `0004_private_event_details.sql` adds four nullable text columns to `events`: `service_plan`, `contact_name`, `contact_email`, and `contact_phone`. It also adds `revision TEXT NOT NULL DEFAULT 'legacy'`. It has no inserts, backfill, destructive statements, or customer content. All existing notes and inquiry records remain unchanged.

For old linked bookings, a new field that is NULL displays its corresponding inquiry default. An intentionally cleared empty string stays empty. Name/phone defaults collapse embedded line breaks to spaces for single-line inputs; original inquiries and existing saved overrides are not rewritten. Existing notes are never split, trimmed, reconstructed, or truncated. The new 6,000-character notes limit accommodates historical conversion notes that combined services with a 3,000-character customer message.

## Safe editing and deletion

- Every new event and successful detail update gets a fresh UUID revision. Updates atomically match the event ID and expected revision. The legacy sentinel is replaced on the first successful edit.
- UUID revisions also distinguish a canceled/rebooked event from its older incarnation, even though the linked event ID is reused.
- Stale saves return 409. Refresh does not replace a dirty draft. **Reload saved details** explicitly confirms replacing unsaved changes.
- Switching Studio tabs or calendar selections retains an edit draft; browser navigation away warns when it is dirty. Choosing a different event editor or canceling dirty edits asks before discarding them.
- Missing/deleted events cannot be recreated by saving an old editor. Unsaved text can be copied before discarding it.
- Failed sign-in clears both event-editor and add-date private drafts. Other read failures hide private forms until a successful refresh. An uncertain mutation is not retried automatically.
- Removing a manual event requires its displayed revision. Changing an inquiry away from Booked warns that the calendar entry and its private details will be deleted, then requires the linked event's current revision. The status update and conditional deletion are one transaction. Existing cancellation semantics are unchanged.

## Privacy and exports

All details remain behind the existing Studio/manager Access guard. The public events API keeps its explicit public-field selection, including for appearances that are themselves public. No authentication configuration or allowlist is changed.

Calendar downloads retain their existing behavior: they contain event times, venue, existing private notes, and the Facebook link. The new services/contact fields and revision are **not** silently added to downloaded calendar files. A downloaded file containing notes should be treated as private. No live calendar sync is introduced.

## Checks and release

Run `pnpm test && pnpm typecheck && pnpm build`. The API suite executes real Drizzle D1-generated SQL against isolated SQLite with synthetic records. It covers migration preservation, defaults, explicit clears, concurrent edits, stale deletion, cancel/rebook identity, transaction rollback, validation and public-field exclusion. Studio tests exercise actual component handlers and fields, interrupted/repeated actions, draft/navigation preservation, session expiry, missing events, contact links and note limits. Data checks run in New York, Honolulu and UTC.

These deterministic checks are not browser-layout or authenticated production validation. Verify the calendar detail card/editor at desktop and phone widths after an authorized release, without creating production test bookings.

Production release requires explicit approval to publish the source, apply this additive D1 migration through the existing deployment pipeline, and deploy the Worker. Do not run manual production SQL. Apply migrations before serving the updated management code. Existing open Studio tabs should be reloaded after release so their delete/status requests include revision acknowledgements; older tabs fail safely rather than removing event details without one.
