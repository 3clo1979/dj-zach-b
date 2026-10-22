# Studio control room

The private `/studio` uses the existing Access-protected management APIs; the public website and all existing booking/testimonial workflows are retained.

## The desk

- **On the Deck:** real Pending testimonial count, New inquiry count, next saved non-blocked event, next seven calendar days, upcoming booking/public-appearance counts. Loading/unavailable counts are `—`, never fabricated zeroes. A blocked date appears in the weekly agenda but is not advertised as the next event.
- **Booking Desk:** existing inquiry status changes, email/phone links and booking lifecycle. Changing an inquiry to Booked still creates its private schedule entry; changing away releases it.
- **Calendar:** local calendar dates, month navigation, selected-day details, upcoming/past/all schedule, add/remove flows, and unchanged all-day ICS downloads with event times in notes. Saved events have a private services/bring-along plan, editable notes and a primary contact; see [EVENT-DETAILS.md](./EVENT-DETAILS.md). No empty day implies confirmed availability; phone/Yahoo sync and email notifications are not connected.
- **Client Voices:** the existing original-wording, version-checked publish/unpublish/archive/restore flow and audit evidence. The dashboard and navigation badges follow its successful private fetches.
- **Settings:** original-photo frame upload and practical connection/privacy notes. See [STUDIO-PHOTO.md](./STUDIO-PHOTO.md) for storage limits, authorization, and backup retention.

Navigation uses native anchors and URL hashes, with Back/Forward support. Mobile keeps the same four primary destinations in bottom navigation and Settings in its menu. The public-site link uses a new tab. No Next/Vinext Link runtime dependency was introduced.

## Safety and recovery

All existing server guards, public/private APIs, testimonial auditing, and unique-date constraints remain unchanged. The new photo endpoint uses the same signed Access/allowlist guard and additionally requires exact Origin/version for mutations. Nothing in the UI bypasses authentication.

The desk locks repeated mutations immediately. Failed authorization clears loaded private records. An interrupted or unparseable mutation response is treated as uncertain, clears action controls, and requires a read-only refresh before a retry. A completed save does not override newer navigation; Cancel cannot pretend to cancel an already-submitted write.

## Local checks

Run `pnpm test && pnpm typecheck && pnpm build`. New deterministic suites cover the actual component handlers, original photo lifecycle/API, and date/count/ICS helpers in New York, Honolulu, and UTC. Test fixtures remain in scripts or ignored local work, never production UI.

A standalone local Playwright harness can be prepared in ignored `work/studio-preview/`; this is a test-only renderer with local intercepted fixtures, not an authentication bypass or production route.

## Release boundary

The original control-room database change is `0003_private_studio_photo.sql`, creating one empty photo table. The event-details feature adds the five non-destructive event columns in `0004_private_event_details.sql`, without backfilling or rewriting existing notes/inquiries. Existing deployment pipeline remains `pnpm run db:migrate && pnpm run deploy` after building.

Publishing source, deploying the Worker, applying the table, and uploading an actual photo are distinct external changes. The local implementation does none of them. After authorized release, verify the exact remote commit/build, anonymous denial for Studio/manager/photo URLs, public-site behavior, then authenticated desktop/mobile workflows. A real photo is saved only by an authorized owner action in Studio Settings.
