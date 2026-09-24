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

| Instrument                                          | What it measures                                                                                                          | What it cannot say                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| DebugBear browser runs (`api/scripts/debugbear.ts`) | The email reader's visit in real, headful Chrome from Paris, California and South Carolina, on both sites. The verdict.   | Louisiana: no location nearer than South Carolina. Only what the journey script times, per photo. |
| Idle probes (`api/src/probes.ts`, Globalping)       | One request at a time from San Jose, Los Angeles, Paris and Baton Rouge, after idle gaps of 1 to 9 hours set by the cron. | Anything about a page: each request is on a fresh connection, with no page around it.             |
| The Worker's own headers (`x-d1`, `server-timing`)  | Where the Worker ran, how long it spent, and which D1 instance answered and how long it took. Exact, whatever the client. | Anything outside the Worker.                                                                      |

## Browser runs

[DebugBear](https://www.debugbear.com) runs the visit in real Chrome with its window open, so connection hints, HTTP/3 and connection reuse behave as they do for readers. Its project holds six pages, one per site per location, each on `/2025/09-29` (30 photos copied from AWS production with `api/scripts/import-album.ts --from prod`), so the two sites serve the same album from the same app.

- **Locations:** France (Paris), US West CA (California) and US East (South Carolina). South Carolina stands in for Louisiana and Atlanta; DebugBear has nothing nearer.
- **Device:** `Desktop unthrottled`, a device defined in the project with no added latency, no bandwidth cap and no CPU slowdown. The built-in `Desktop` adds 40 ms to every round trip.
- **Visit:** DebugBear loads the album page and records its time to first byte and LCP. The `Vienna Journey` setting below starts with the page, as DebugBear runs every snippet, so it waits for the page's load event and a reader's median 2.3 s on the album before opening the first photo; clicking sooner would let the photo become the album page's LCP. It then steps through the next seven at 2.3 s a photo, recording each from click to photo decoded as `photo-01` to `photo-08`. With eleven photos, every Cloudflare run stopped after the tenth, about 26 s after the page started loading, where the AWS runs, whose journeys started earlier, got all eleven; eight leaves room.
- **Schedule:** `.github/workflows/perf.yml` runs `node api/scripts/debugbear.ts run` at 05:23, 11:23, 19:23 and 22:23 UTC, two hours from every idle-probe run: every page once, then again as soon as all have finished. The pages have no DebugBear schedule of their own.
- **Cold or warm:** `node api/scripts/debugbear.ts report` marks a run warm when the same page ran in the 30 minutes before it, and cold otherwise, so a run is classed by what reached the site before it rather than by which request started it. Creating or editing a page in DebugBear starts a test of its own.
- **Background traffic:** the idle probes hit the Cloudflare site five times a day, and Grafana checks hit the AWS API and page from Paris, Ohio and Northern California. A Paris probe can leave D1's London replica active for a Paris browser run that follows it.

The `Vienna Journey` setting, kept here because DebugBear's API can attach a setting to a page but not create or edit one:

```js
// DebugBear runs this as soon as the page starts loading. Once the album page has loaded and been looked at for a
// reader's median 2.3 s, open the first photo, then step through seven more at the same pace, timing each from the
// click or keypress until the new photo has loaded and decoded.
const PHOTO = 'a[aria-label^="View full-size image"] img';
const DWELL_MS = 2300;
const PHOTOS = 8;

async function photoShown(step, previousSrc) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const img = document.querySelector(PHOTO);
        if (img && img.src !== previousSrc && img.complete && img.naturalWidth > 0) {
            await img.decode().catch(() => {});
            performance.mark(`${step}-shown`);
            performance.measure(step, `${step}-start`, `${step}-shown`);
            return img.src;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    performance.mark(`${step}-timeout`);
    return previousSrc;
}

await new Promise((resolve) => {
    if (document.readyState === 'complete') {
        resolve();
    } else {
        window.addEventListener('load', resolve, { once: true });
    }
});
await new Promise((resolve) => setTimeout(resolve, DWELL_MS));
const firstThumbnail = await waitForElement('a[href^="/2025/09-29/"]');
performance.mark('photo-01-start');
firstThumbnail.click();
let src = await photoShown('photo-01', null);

for (let n = 2; n <= PHOTOS; n++) {
    const step = `photo-${String(n).padStart(2, '0')}`;
    await new Promise((resolve) => setTimeout(resolve, DWELL_MS));
    performance.mark(`${step}-start`);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    src = await photoShown(step, src);
}
```

## What is known

### From the browser runs

The first runs, 2026-09-24 at 01:53 UTC, about an hour after `/2025/09-29` was copied in and half an hour after an idle-probe run. Each page ran three times within six minutes: once on its creation or edit and twice by request. The cold row is each page's first run; warm is the median of the other two. LCP is when the first thumbnail appears; first photo is from its click to the photo decoded.

| Location       | Run  | TTFB, Cloudflare / AWS | LCP, Cloudflare / AWS | First photo, Cloudflare / AWS |
| -------------- | ---- | ---------------------- | --------------------- | ----------------------------- |
| France         | cold | 43 / 448 ms            | 3,230 / 2,720 ms      | 1,907 / 979 ms                |
| France         | warm | 116 / 397 ms           | 1,632 / 1,624 ms      | 421 / 443 ms                  |
| California     | cold | 121 / 322 ms           | 1,792 / 1,818 ms      | 645 / 612 ms                  |
| California     | warm | 102 / 317 ms           | 1,640 / 1,978 ms      | 629 / 604 ms                  |
| South Carolina | cold | 88 / 192 ms            | 1,817 / 2,933 ms      | 544 / 1,844 ms                |
| South Carolina | warm | 86 / 315 ms            | 1,624 / 1,747 ms      | 628 / 532 ms                  |

- **Every later photo took 23 to 115 ms on both sites**, since both apps preload the next and previous photo during the reader's 2.3 s on each.
- **Cloudflare's page arrives in 43 to 121 ms against AWS's 192 to 448 ms**, but its LCP stays near 1.6 s even warm: the app loads its JS, then the album, before any thumbnail shows.
- **These LCPs may include the first photo.** The journey then clicked the first photo as soon as its thumbnail appeared, before the page's load event, so a run's LCP may be the photo rather than a thumbnail. The scheduled runs wait for the load event first.
- **Cold France went to AWS**: Cloudflare's first run there took 3.2 s to the first thumbnail and 1.9 s for the first photo. One sample; the scheduled runs will say whether it holds.

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
- **2026-09-24, 00:08 to 00:11 UTC:** the day album `/2024/12-17/` copied from AWS staging into the deployed site, 30 originals through the upload pipeline, so the 00:23 and 01:23 UTC probes ran on a database and bucket just written to.
- **2026-09-24:** `web/` replaced by a port of the AWS app (`docs/Risks.md` row 5), so both sites now run the same app with the same photo preloading, and the Worker answers in the AWS API's shapes. The comparison still waits on a real day album in the Cloudflare database (_Before the first run_, step 1).

- **2026-09-24, 00:50 to 00:51 UTC:** `/2025/09-29/` (30 photos) copied from AWS production into the deployed site, a day album no reader had opened in the logs' twelve days, so the comparison runs against production rather than staging.
- **2026-09-24, 01:53 UTC:** DebugBear set up in place of WebPageTest, whose free plan has no API or scheduling, and the first runs taken (_From the browser runs_ above). The scheduled workflow takes over from here.

## Open questions

- How long a D1 replica stays active after its last read, and whether a Durable Object in Western Europe reading every few minutes keeps Paris on the London replica.
- Whether a Durable Object in Western Europe holding the album JSON answers a cold Paris read in tens of milliseconds.
- Whether `<link rel="preload">` for the album JSON, starting it alongside the JS, is worth the roughly 120 ms of page download it would overlap.
