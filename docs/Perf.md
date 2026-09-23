# Performance

Whether pix.tacocat.com on Cloudflare would feel faster than it does on AWS today. This page holds the goal, how it is measured, what has been found and what has been tried. The AWS side is written up in `docs/plans/EdgeCachedAlbums.md` in `tacocat-gallery-sam` and `docs/plans/Observability.md` in `tacocat-gallery-sveltekit`; this page summarizes them rather than copying them.

## Goal

Perceived performance strictly better than the AWS site, or at least better in almost every case. A case is a scenario: a reader in California, Louisiana or France loading an album page, either cold, after an hour or more in which nobody has touched the site (the usual case at this traffic), or warm, just after someone else was there. Each scenario is judged on the whole page load as the reader sees it, not step by step: Cloudflare can lose one step, such as the album JSON, and still win the page. Timings of single steps explain a result; they do not decide it.

The verdict is a page load in a real browser from a reader's region. Timings of single requests are for finding out why a page is slow, not whether it is: they miss what a browser does with connection hints, HTTP/3 and connection reuse, which is why the local `npm run perf` script in `tacocat-gallery-sveltekit` is not a verdict either (its bundled Chromium ignores `preconnect`).

## How readers use the site

An email goes out every week or so with the newest albums. A reader follows its link straight to a day album, clicks through its photos, and leaves; few start at the root or a year. The AWS app's CloudFront logs agree (`album_reads` in `tacocat-gallery-sveltekit`'s `production_logs`, real visitors only, 2026-09-12 to 23):

- **57 album reads by 30 readers**, most of them on the newest three albums.
- **Photos outnumber album opens about ten to one:** 574 photo requests against 57 album reads. A reader gets a median of 5 photos and a quarter get 18 or more, counting the neighbours the app preloads; the newest album's readers got a median of 21.
- **78% of photos came from the bucket, not the edge,** at 299 ms median and 411 ms p90 to first byte, since each photo is seen about once per edge. The median gap between photos is 2.3 s.
- **The AWS app preloads the next and previous photo** (`<link rel="preload">` in its `MediaPage.svelte`), so a click usually finds the photo already loading or loaded.

So the scenario that matters most is clicking from one photo to the next, and the album page is the one-off cost of arriving.

## Instruments

| Instrument                                         | What it measures                                                                                                          | What it cannot say                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| WebPageTest, first view in real Chrome             | A page load from a chosen city, with the browser's own connection handling. The verdict.                                  | Only as many samples as can be run by hand; the free plan has 300 runs a month and no API or scheduling. |
| Idle probes (`api/src/probes.ts`, Globalping)      | One request at a time from San Jose, Los Angeles, Paris and Baton Rouge, after idle gaps of 1 to 9 hours set by the cron. | Anything about a page: each request is on a fresh connection, with no page around it.                    |
| The Worker's own headers (`x-d1`, `server-timing`) | Where the Worker ran, how long it spent, and which D1 instance answered and how long it took. Exact, whatever the client. | Anything outside the Worker.                                                                             |

## WebPageTest protocol

The two sites have to serve the same page for the comparison to mean anything, which today they do not (see _Before the first run_).

- **Visit:** what an email reader does, scripted in WebPageTest: open one day album with real photos, the same on both sites (`https://pix.tacocat.com/<year>/<day>` against `https://pix.deanmoses.com/<year>/<day>`), open its first photo, then click next through ten more. Whether the free plan runs scripted multi-step tests is unchecked.
- **Locations:** Paris for France and Los Angeles for California. The free plan has nothing in the US South (its North American locations are Los Angeles, Salt Lake City and Toronto), so Louisiana has no page-load verdict; the idle probes time its steps only.
- **Settings:** Chrome, desktop, native connection (no throttling), first view only, one run per test. Repeat view measures the browser's own cache, which both sites set the same way.
- **Cold:** run only when both sites have been idle for at least an hour, and record how long. Warm is the same test again a minute later, still in a fresh browser, so the site has just served that page. The idle probes hit the Cloudflare site five times a day at fixed times (00:23, 01:23, 03:23, 07:23 and 15:23 UTC), and Grafana checks hit the AWS API and page from Paris, Ohio and Northern California; that is each site's real background traffic and is left alone.
- **Order:** the two sites back to back from the same location, alternating which goes first.
- **Record:** the album page's LCP, and for each click the time until the photo is on screen; together they decide the scenario, with the photo clicks weighing most. Also the page's time to first byte, the album JSON request's start and end, and each photo's request from the waterfall, to explain it. Keep the test URLs.
- **Budget:** each site cold then warm is four runs per location, eight a session for Paris and Los Angeles. 300 runs a month is about 37 sessions.

### Before the first run

1. The Cloudflare database holds made-up albums (60 a year, 20 images each), not real photos. Copy one real day album into it, originals through R2's S3 API so the upload pipeline makes its derived images, and check its page renders every thumbnail.
2. ~~The Cloudflare site's `web/` app was written from scratch and lacks what the AWS app does, such as preloading the next and previous photo.~~ Done 2026-09-24: `web/` is a port of the AWS app, so the two sites run the same app and the comparison measures the platforms.

## What is known

### AWS today

From the two AWS documents, measured September 2026:

- **Album leg of a page load from the Bay Area:** 341 ms median in `npm run perf`, from its second to sixth runs in a burst; a genuinely idle first run was 174 ms slower. The API is a separate origin in us-east-1 whose TLS terminates there, about 155 ms of handshake, which `preconnect` mostly hides under the page download.
- **Lambda cold starts:** in two weeks of logs to 2026-09-10, about three quarters of first requests after 2 minutes idle were cold, at about 455 ms. A later week of production album fetches had a 79 ms median after more than an hour idle, so `GetAlbum` may now be held warm, possibly by the Grafana checks.
- **Paris:** connect plus TLS to the API is 171 ms. Through CloudFront, an origin miss from the Paris edge took 360 ms for a 25 ms origin, because the edge's connection to Virginia is cold on nearly every request.
- **Immutable JS chunks** stay in CloudFront edges: 96 to 98% hits within three hours, about 81% at six hours to a day, none after three days, and some edges (Atlanta) drop them within a day. A miss goes to S3 in Virginia, about 280 ms from Paris.

### Cloudflare, from the idle probes

Three runs on 2026-09-23: the first ever, then after 4 and 8 hours idle. First album read at each location; D1's primary is in San Jose.

| From        | TTFB          | In the Worker | D1 answered from    |
| ----------- | ------------- | ------------- | ------------------- |
| Bay Area    | 127 to 174 ms | 20 to 43 ms   | primary             |
| LA          | 130 to 256 ms | 17 to 33 ms   | primary             |
| Baton Rouge | 225 to 408 ms | 67 to 301 ms  | primary, every time |
| Paris       | 444 to 667 ms | 338 to 631 ms | primary, every time |

- **The Worker is not cold.** It ran in Paris for every Paris probe, and TTFB minus the Worker's time is the same on the first read after idle as on the warm repeat seconds later (about 106 ms from Paris). The idle cost is all D1.
- **The regional replicas are inactive at this traffic.** D1's replicas are "active/inactive based on query traffic". Baton Rouge's second read reached the Dallas replica (about 20 ms); Paris stayed on the primary for 8 of 9 reads, 173 to 194 ms even warm, and reached London once (49 ms). A read does not activate the replica within the few seconds between probe steps.
- **Static assets are served locally from the first request.** One Globalping probe each from Paris and Baton Rouge on 2026-09-23 requested `/2001/06-15` and the entry chunk twice on each site, the chunk never before requested at those locations:

| From        | Request     | Cloudflare, first / repeat TTFB | AWS, first / repeat TTFB        |
| ----------- | ----------- | ------------------------------- | ------------------------------- |
| Paris       | album page  | 31 / 20 ms, HIT                 | 286 / 290 ms, origin both times |
| Paris       | entry chunk | 34 / 31 ms, HIT                 | 294 ms miss / 7 ms hit          |
| Baton Rouge | album page  | 171 / 66 ms, HIT                | 139 / 187 ms, origin both times |
| Baton Rouge | entry chunk | 127 / 82 ms, HIT                | 162 ms miss / 63 ms hit         |

CloudFront serves an album page through its error response for the single-page app, so it goes to S3 in Virginia on every request. The Baton Rouge probe's own network adds 40 to 60 ms to each request (its TCP time).

## Ruled out

- **Caching album JSON at the edge.** At this traffic most album views are the first of that page at that edge: a week of the AWS site's logs gives a 35 to 40% hit rate, and Cloudflare has more locations near the readers, so the same views split across more caches. On Cloudflare, derived images cached per location went back to R2 in Western North America on most first requests (250 to 550 ms from Baton Rouge and Paris), and Tiered Cache did not help.
- **The page load waking the replica before the album request.** The page and chunks never reach D1, and a read does not activate a replica within seconds anyway.

## Log

- **2026-09-23:** idle probes deployed on 2026-09-22 read the first three runs above. Edge caching of albums ruled out. WebPageTest chosen as the verdict instrument. Static assets probed from Paris and Baton Rouge: served locally on Cloudflare from the first request. The AWS logs show photo clicks outnumbering album opens about ten to one, so the scenario is now the email reader's visit. `web/` turned out to be a from-scratch rewrite missing the AWS app's photo preloading; the comparison waits for a port.
- **2026-09-23, 23:53 to 23:58 UTC:** the two-level item type migration rebuilt the `item` table on the deployed D1 and the ported app was deployed, half an hour before the 00:23 UTC probe, so that run's primary was not idle.
- **2026-09-24:** `web/` replaced by a port of the AWS app (`docs/Risks.md` row 5), so both sites now run the same app with the same photo preloading, and the Worker answers in the AWS API's shapes. The comparison still waits on a real day album in the Cloudflare database (_Before the first run_, step 1).

## Open questions

- How long a D1 replica stays active after its last read, and whether a Durable Object in Western Europe reading every few minutes keeps Paris on the London replica.
- Whether a Durable Object in Western Europe holding the album JSON answers a cold Paris read in tens of milliseconds.
- Whether `<link rel="preload">` for the album JSON, starting it alongside the JS, is worth the roughly 120 ms of page download it would overlap.
