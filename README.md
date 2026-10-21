# DJ Zach B

Wedding-first website with preserved gold headphone branding, photography, event inquiry builder, D1-backed inquiries and schedule, and a protected management studio. This is the independent Cloudflare Workers export of the approved design, not a static-only site.

## Deployment

Use Node 22.13+ and pnpm 11.25.0. The lockfile is included.

1. Install with `corepack enable && pnpm install --frozen-lockfile`.
2. Create the Cloudflare D1 database named `dj-zach-b` in the same account as the Worker. Replace the placeholder `database_id` in `wrangler.jsonc` with its actual UUID. Never deploy using the placeholder.
3. Run `pnpm exec wrangler d1 migrations apply dj-zach-b --remote` to create the tables and unique-date index. The SQL migrations contain schema only, no customer records.
4. Run `pnpm test && pnpm typecheck && pnpm build`.
5. Run `pnpm deploy`. For Cloudflare Workers Builds use build command `pnpm build` and deploy command `pnpm deploy`. The Vite Cloudflare plugin generates the deployment configuration and asset manifest. Do not use a Pages static-directory deployment.
6. In the Worker Settings → Domains & Routes, attach `djzachb.com` and `www.djzachb.com` as custom domains. Verify both HTTPS URLs, all images, public appearances and inquiry submission.

The Worker can serve the public site without Access configuration, but all private studio/API data stays denied. Inquiry saving needs the real DB binding and migrated schema.

## Required private studio protection

Create one Cloudflare Zero Trust Access self-hosted application with these protected paths for BOTH custom domains:
- `/studio` and `/studio/*`
- `/api/manage` and `/api/manage/*`

Allow only `3clo1979@gmail.com` and `djzachb@yahoo.com`, using your chosen supported sign-in method. Do not protect the entire public site or `/api/inquiries` or `/api/events`.

Copy the Access application AUD tag and HTTPS team domain into `wrangler.jsonc` vars (`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`), then build and redeploy. Example team format: `https://your-team.cloudflareaccess.com` with no trailing slash. These are configuration identifiers, not secrets. Do not commit API tokens, passwords or session cookies.

The application verifies the Access JWT signature against that exact team's signing keys, plus issuer, audience, expiry, and the two-email allowlist. Missing or invalid configuration fails closed. It never trusts browser-supplied identity/email headers. The same origin verification applies at workers.dev, so anonymous direct-origin requests cannot obtain private data. Open `/studio` through a protected custom domain for the Access sign-in flow.

Before real inquiries are accepted, verify that an anonymous `GET /api/manage` returns 403, spoofed identity headers still return 403, and authorized Access login can access the studio. Never weaken these checks to make a deployment appear successful.

## Operation

- Requests save to D1 as `New`; they are NOT emailed. Email notifications are not configured. Phone/text remains available.
- Marking an inquiry `Booked` adds a private schedule entry. Changing it out of `Booked` releases that entry. Dates are unique to prevent double booking.
- Public appearances require staff to explicitly select public visibility. Public API omits client data and internal notes.
- Calendar export downloads an all-day ICS entry with times in notes; it is not continuous iPhone/Yahoo sync. Existing commitments must be checked manually.
- Facebook uses the supplied profile and optional public-event links, not automatic Facebook sync.

## Tests

`pnpm test` covers inquiry validation, manager guards, public/private separation, booking lifecycle, and cryptographic Access JWT validation with generated test keys. `pnpm typecheck` checks TypeScript. Run `pnpm build` before deployment. Tests are local and do not send real customer inquiries.

Authentication reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
