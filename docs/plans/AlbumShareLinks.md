# Album share links

A link an admin can send to people who are not the usual "inner circle" readers of Tacocat gallery, such as the guests of a party, that shows one album and nothing else of the gallery.

## Example Use Case

After our Halloween party we want to send its album to the 60 guests, most of whom are not regular readers. We don't want them shown decades of our lives: the album's link should not lead to the year, the albums before and after it, search, or anything else. Regular readers keep getting the normal link in the weekly update.

This is privacy in the most casual sense. The whole gallery is public to anyone who types `pix.tacocat.com`, and a guest reading the page's source and finding a gallery path is fine. What matters is that nothing on the page, and nothing a guest gets by trimming the URL, shows them the rest. That rules out a URL whose structure means something, such as `album.tacocat.com/2025/10-31`, where changing the date is as casual as deleting the path.

The feature will be used a few times a year, so it is only worth having if does not add much complexity to the system.

## What a guest sees

- `album.tacocat.com/<id>` is the album's normal page, Tacocat's header and logo included, with its photos.
- `album.tacocat.com/<id>/<photo>` is a photo's normal page, with previous and next between the album's photos.
- Gone: previous and next between albums, the link up to the year, search, login, the logo's link, links in a description that lead into the gallery, and the arrow keys moving between albums.
- An unpublished album shows the error page a guest sees for it on `pix.tacocat.com` today. Whether an album is published is already something we think about before sending its link.
- Any other path on `album.tacocat.com`, the bare root included, shows "Nothing here", with no link.

## What an admin sees

In edit mode a day album has a button that copies its share link. It is always there, published or not.

## The ID

8 characters of Crockford's base32 in lowercase: `0-9` and `a-z` without `i`, `l`, `o` and `u`, so it has no look-alike characters and no mixed case. That is 32⁸, about 1.1 trillion IDs. Even if every album and photo had one someday, about 50,000, a guess would find one about once in 22 million tries, and the chance of any two colliding over the gallery's life is about 1 in 1,000. So there is no retry: a collision fails the unique constraint, the click gets a 500, and a second click works.

The Worker makes it with `crypto.getRandomValues`.

## How it's built

### Data

A nullable, unique `share_id` column on `item`, starting in `schema.ts` and generated like any other migration. Nothing fills it in: an album gets its ID the first time an admin clicks the button, so most never have one. SQLite cannot add a column with a random default to an existing table, so giving every album an ID up front would have needed a backfill or a trigger.

The column gets a fixture in `api/test/db/migrations.test.ts`, and both queries below get a case in `api/test/db/rows-read.test.ts`.

### API

- `POST /api/share/<album path>`, admin only, answers the album's ID, making one if it has none, in one statement: `UPDATE item SET share_id = coalesce(share_id, ?) WHERE <the album> RETURNING share_id`.
- `GET /api/share/<id>` answers the album's path, and 404 for an ID no album has. It does not care whether the album is published: the app then reads the album by its path as it always does, and that read hides an unpublished album from a guest.

Both go in `API` in `shared/src/api.ts`. `/api/*` is already in `run_worker_first`.

Answering a path rather than the album costs a guest one round trip on the first load, and in return nothing in how the app loads, caches and refreshes an album changes.

### The app

- **The scoped flag.** The root `+layout.svelte` decides from `location.hostname` whether the app was opened on the share host, and hands that to every component with Svelte context. It is fixed for the life of the page.
- **"Nothing here."** When the flag is set and the route is not one of the two below, the root layout shows "Nothing here" instead of the page: one check in one place, not one per route.
- **Two routes**, `/<id>` and `/<id>/<photo>`, with a matcher in `web/src/params/` that accepts an ID. Their `+page.ts` turns the ID into the album's path and starts the album fetch as the day album and photo routes do, and their `+page.svelte` renders the existing `DayAlbumRouting` and `MediaRouting`. No page or component is copied.
- **The components** that link elsewhere read the flag from context and leave those links out: the previous and next album buttons and the up button on the day album page, the up button on the photo page, the header's search, login and logo link, and the keyboard navigation in the root layout, which keeps moving between photos but not between albums. Links to photos, from the thumbnails and the photo page's previous and next, become `/<id>/<photo>`.
- **Descriptions.** When the flag is set, a link in an album's or photo's description that leads into the gallery, root-relative or naming `pix.tacocat.com` or `staging-pix.tacocat.com`, is replaced by its text. Links to other sites stay.
- **The button** in the day album's edit mode calls `POST /api/share/<path>` and copies `https://album.tacocat.com/<id>`, or the staging host on staging.

`docs/WebApp.md` says `site/` components know nothing of the stores. Context is not a store, but it needs a sentence there saying the scoped flag is the one thing a `site/` component may read.

### Infra

- `album.tacocat.com` and `staging-album.tacocat.com` as custom domains of the production and staging Workers, beside `pix.tacocat.com` and `staging-pix.tacocat.com` in `api/wrangler.jsonc`, then `npm run types --workspace api`. A custom domain makes its own DNS record, so `infra/` changes only in the note in `docs/Infrastructure.md` that lists the names with no record in the config.
- Every header the Worker and `_headers` send applies to the new host unchanged. The session cookie is the host's own, so the share host never has a logged-in admin.
- A share photo URL has the shape of a day album, so `_headers` sends a share photo page two preloads of albums that do not exist. They fail quietly in the background and nothing waits on them. The share album page gets no preload.

### Local development

The browser resolves `album.localhost:8787` to the local Worker, so the share host works locally with nothing configured.

## Tests

- **Worker:** making an ID once and getting the same one back, an ID for an album that has none, the 404 for an unknown ID, and a guest refused the `POST` (the existing admin-endpoint test covers that once it is in `API`).
- **App:** the components with the flag set leave out what they should and link photos by ID; the description filter keeps outside links and unwraps gallery ones; keyboard navigation stops at the album.
- **e2e:** a journey on `album.localhost` through the album and a photo, checking nothing leads out, and the bare root showing "Nothing here".

## Not in this

- **The image cache's key** takes the request's host, so the share host warms its own copies of images `pix.tacocat.com` has already cached. That costs a read of the derived bucket on a first view, never a new transformation. It is its own small fix, keying on a fixed origin, whenever someone wants it.
- **A preload for the share album page.** `_headers` matches paths by placeholder and cannot tell a share URL from a day album's; host-qualified rules might, but how `! Link` stacks across rules is undocumented, and saving a few hundred milliseconds once a year is not worth finding out.
- **Year albums.** Only a day album gets a button.
- **Taking a link back.** Unpublishing the album ends it, for every link to it.
