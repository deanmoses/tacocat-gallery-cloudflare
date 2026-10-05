# Scripts

Each script says how to run it in the comment at its top, and the secrets it needs come from `api/.dev.vars`. Those that write to a gallery take `--to` for the environment and write nothing without `--go`, through `write-guard.ts`; the recovery scripts also take `--only <album>` or `--all` for the scope.

- `media.ts` prints an item's row and every object stored for its version, since the buckets are keyed by version id and the dashboard cannot browse them by album.
- `debugbear.ts` starts the browser runs, reports them, reads one run's requests, and manages the DebugBear pages; `docs/Perf.md` says what the runs measure. `.github/workflows/perf.yml` starts a run from the Actions tab. `debugbear-journey/journey.js` is the visit each run makes, which DebugBear runs in the page; its API cannot change it, so an edit is pasted into the dashboard.
- `d1-round.ts` reads an album through Globalping from Paris and then San Jose and prints what each response said about the Worker and D1.
- `invite.sh` mints a one-time invite link for an admin's passkey, and `passkey-selftest.ts` drives the whole login against a local Worker without a browser (Admin login in `docs/Operations.md`).
- `ship-transcoder.ts` builds and ships the transcoder's image, which the release runs for itself (The transcoder's image in `docs/Releasing.md`).
- `delete-detail-derivatives.ts` deletes the JPEG derivatives the Images binding wrote with the original's metadata still in them, which `detail-derivatives.ts` picks out by key, so each is made again, stripped, on its next request; purge the zone's cache after it.

## `recovery/`

The recovery of what earlier galleries left behind, as `docs/plans/RecoverPreAwsGalleries.md` describes. Nothing else imports from here, and the directory goes once that plan is done.

- `recover-zenphoto.ts` brings over what the 2023 move from Zenphoto to AWS left behind: each album Zenphoto never published, made unpublished here, with its words from Zenphoto's database and its files from Dropbox through the read-only rclone remote, each uploaded as a browser uploads one. A rerun uploads only what an album lacks. `recover-gallery2.ts` does the same for the albums, photos and words of Gallery 2's that the 2014 move to Zenphoto dropped, taking a file Dropbox lacks from Gallery 2's own copies under `files/` in the directory it is given. `recover-static.ts` brings back the static gallery's photos that `static-gallery.ts` names, from its own copies the same way. `recovery.ts` holds what the three share, and `gallery-upload.ts` their writes to the gallery. `reorder-gallery2.ts` puts the albums Gallery 2 ordered by hand back into that order, which the 2014 move lost, writing only orders, as `gallery2-order.ts` decides them. `rethumb-gallery2.ts` gives back the thumbnails Gallery 2's admin cut, which the same move lost, writing only crops, as `gallery2-thumbnails.ts` decides them. `relink-descriptions.ts` points the links in descriptions that hold the old galleries' addresses where Moses picked them from a contact sheet, writing only descriptions, as `description-links.ts` applies a pick.
- `aws-names.ts` and `aws-crops.ts` are the rules the copy from AWS named and cropped by, so a recovered item matches the copied gallery.
- `check-s3-versions.ts` compares the AWS rows with the AWS originals bucket's version listing, for rows the copy would pair with the wrong file.
