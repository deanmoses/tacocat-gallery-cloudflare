# Authentication and crawlers

## Passkeys and sessions

- Admins log in with passkeys. There is no password and no identity service.
- The users are seeded by a migration. An invite link lets its holder register a passkey as one of them, once; Admin login in `Operations.md` has how one is minted.
- A passkey is bound to the site's origin, `SITE_ORIGIN` in each environment's vars, or in development one of `LOCAL_ORIGINS`, which production leaves empty.
- A session is a signed cookie holding the admin's name and an expiry, `SameSite=Strict`, so the browser sends it only with requests from pages of the same site. A site to the browser is the registrable domain, so a page on another host of it, staging say, sends it too; what keeps such a page from writing is that every write from a browser must name one of the environment's own origins in `Origin`. Checking the cookie reads no database; the price is that a session can be ended early only by rotating `SESSION_SECRET`, which logs everyone out.
- A session lasts 30 days from when it was signed, and an API request that brings one signed more than a day ago gets a fresh one back, so each device an admin keeps using stays logged in, with no limit. Renewal checks no `user` row either, so removing a user does not end their sessions; rotating `SESSION_SECRET` does, and ends a stolen cookie's too, at the cost of one passkey touch per device for every admin. A request still in flight when an admin logs out can land after the logout and set a renewed session, logging the device back in; the page reloads after logout and shows the admin controls again if so.
- Reads never require login. Writes always do.

## Headers and crawlers

The site is hidden from the internet. It stays out of search engines and AI training:

- Every response says `noindex` and refuses AI training; the media routes also refuse being embedded by other sites.
- `robots.txt` lets ordinary crawlers in so they see the `noindex`; Cloudflare's zone settings add its list of AI crawlers to it and turn those crawlers away.
- Two places answer requests, so the headers are set twice: `api/src/http/headers.ts` for the Worker and `web/static/_headers` for the app's files. A test holds the two copies together.
- The derived bucket's public host bypasses the Worker, so a zone rule in `infra/main.tf` gives it the same headers.
