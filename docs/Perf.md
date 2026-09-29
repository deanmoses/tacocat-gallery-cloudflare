# Performance

Whether pix.tacocat.com on Cloudflare would feel faster than it does on AWS today: the goal, how it is measured, what the measurements say, and what has been tried. The AWS side is written up in `docs/plans/EdgeCachedAlbums.md` in `tacocat-gallery-sam` and `docs/plans/Observability.md` in `tacocat-gallery-sveltekit`.

## Where it stands

Browser runs of the email reader's visit to `/2026/09-13`, the four rounds from 22:23 UTC on 2026-09-27 to 19:38 on the 28th, cold and then warm, as medians in ms, Cloudflare / AWS, the faster of each pair in bold. Four runs make each median. A fresh browser holds nothing; a cached one holds the app's JS from a visit to another album seconds before, and nothing of this one. Both sites preload the album JSON from the page's headers and serve WebP thumbnails; Cloudflare has no service worker and AWS still has one; AWS answers an album page from its edge. Within the series, Cloudflare's chunk names, photo-page prefetch and bundle split landed before the 11:23 round on the 28th, and every cold round ran within hours of a release.

| Browser | Site | Location       | Page TTFB    | Album LCP         | First photo   | Later photos |
| ------- | ---- | -------------- | ------------ | ----------------- | ------------- | ------------ |
| fresh   | cold | France         | **99** / 121 | 1,174 / **1,010** | 165 / **115** | **37** / 46  |
| fresh   | cold | California     | 118 / **67** | 1,002 / **938**   | 190 / **124** | **33** / 52  |
| fresh   | cold | South Carolina | **76** / 150 | **934** / 1,114   | 127 / **122** | **35** / 47  |
| fresh   | warm | France         | **72** / 129 | 1,138 / **1,024** | 116 / **110** | **37** / 45  |
| fresh   | warm | California     | 88 / **75**  | 944 / **912**     | 163 / **105** | **33** / 42  |
| fresh   | warm | South Carolina | **87** / 105 | **1,020** / 1,172 | 136 / **120** | **46** / 48  |
| cached  | cold | France         | 21 / **14**  | 630 / **610**     | 120 / **95**  | **40** / 42  |
| cached  | cold | California     | 44 / **21**  | 752 / **634**     | 341 / **109** | **34** / 48  |
| cached  | cold | South Carolina | 25 / **21**  | **638** / 770     | 142 / **135** | **38** / 54  |
| cached  | warm | France         | 26 / **11**  | **644** / 684     | 103 / **101** | **36** / 46  |
| cached  | warm | California     | 51 / **18**  | 822 / 822         | 147 / **125** | **34** / 48  |
| cached  | warm | South Carolina | 28 / **27**  | **834** / 870     | 148 / **133** | **43** / 52  |

- **Album page:** a draw. Cloudflare is first in five of twelve cells and AWS in six, and eight of the twelve are within 100 ms. Cloudflare wins South Carolina, loses France by 20 to 165 ms, and splits California, where one round's runs from DebugBear's machine to Cloudflare were slow across the board. AWS's edge now serves the page and preloads the JSON, which took back most of the head start Cloudflare had.
- **Page TTFB:** Cloudflare's page arrives first for a fresh browser in four of six cells, by 20 to 75 ms. For a cached browser AWS's 11 to 27 ms is the browser's own copy of the HTML shell, which Cloudflare's shell, sent as `must-revalidate`, checks with a round trip.
- **First photo:** AWS first in every cell, by 5 to 65 ms at most medians (the cached California cold cell holds one Cloudflare run of 646).
- **Later photos:** Cloudflare first in every cell, 33 to 46 ms against 42 to 54. This is most of a visit: photo requests outnumber album opens about ten to one.
- **Louisiana** has no browser location nearer than South Carolina.

### Current setup

- **The comparison album is `/2026/09-13`**, 21 photos, the first album uploaded to AWS after its metadata fix of 2026-09-12, on both sites. `node api/scripts/debugbear.ts pages` prints which album the pages test; `repoint` moves them.
- **Twelve DebugBear pages**, one per site per location, and a `warm-browser` twin of each whose setup flow visits `/2025/09-29` on its own site before the test, so the browser holds the app's JS and nothing of the album. That album has to exist on both sites too.
- **Rounds** start from the production Worker's cron at 05:23, 11:23, 19:23 and 22:23 UTC, and again fifteen minutes later; `node api/scripts/debugbear.ts report --from <date>` prints them.
- **After anything that empties or rebuilds production**, import both albums again with `node api/scripts/import-album.ts <album> --from prod --to production` and note the time under _Series notes_; a round that finds no album records nothing, and every image URL and edge cache is new afterwards.
- **A release** renames the app's files when the app changed, so the next cold round fetches every chunk from origin at every location; note a release that lands within a couple of hours of a round.

## Goal

Perceived performance better than the AWS site in almost every case. A case is a scenario: a reader in California, Louisiana or France loading an album page, either cold, after an hour or more in which nobody has touched the site, the usual case at this traffic, or warm, just after someone else was there; in a fresh browser or, as most readers arrive, with the app's JS cached from the last email's album. Each scenario is judged on the whole page load as the reader sees it, not step by step: Cloudflare can lose one step, such as the album JSON, and still win the page. Timings of single steps explain a result; they do not decide it.

The verdict is a page load in a real browser from a reader's region. Timings of single requests are for finding out why a page is slow, not whether it is: they miss what a browser does with connection hints, HTTP/3 and connection reuse, which is why the local `npm run perf` script in `tacocat-gallery-sveltekit` is not a verdict either (its bundled Chromium ignores `preconnect`).

## How readers use the site

An email goes out every week or so with the newest albums. A reader follows its link straight to a day album, clicks through its photos, and leaves; few start at the root or a year. The AWS app's CloudFront logs agree (`album_reads` in `tacocat-gallery-sveltekit`'s `production_logs`, real visitors only, 2026-09-12 to 23):

- **57 album reads by 30 readers**, most of them on the newest three albums.
- **Photos outnumber album opens about ten to one:** 574 photo requests against 57 album reads. A reader gets a median of 5 photos and a quarter get 18 or more, counting the neighbours the app preloads; the newest album's readers got a median of 21.
- **78% of photos came from the bucket, not the edge,** at 299 ms median and 411 ms p90 to first byte, since each photo is seen about once per edge. The median gap between photos is 2.3 s.
- **Both apps preload the next and previous photo**, so a click usually finds the photo already loading or loaded.

So the scenario that matters most is clicking from one photo to the next, and the album page is the one-off cost of arriving.

## Differences from the AWS app

`web/` started as the AWS app unchanged, so the rounds to 2026-09-25 compared the platforms alone; since then it changes wherever that makes the site faster or simpler, and every difference is listed here so a result is read against what both sites were doing. AWS took two of them back.

- **2026-09-26: the album page preloads its JSON.** `web/static/_headers` names the album's JSON and its year's as `Link: rel=preload`, so the browser asks for them as the page's headers arrive, with Early Hints on for the zone, and the album JSON says `Cache-Control: private, no-cache` so the browser hands the app the preloaded copy. AWS did the same on 2026-09-27, through a CloudFront function that also serves the album page as `index.html` from the edge, where it had gone to the origin on every request.
- **2026-09-26: WebP thumbnails, with a 400x400 for 2x screens.** AWS switched to WebP on 2026-09-27; its thumbnails weigh 14.7 KB at the median against 16.0 here.
- **2026-09-26: the app is built for iOS 15.6.** The bundles differ by nothing a measurement sees.
- **2026-09-26: login is a page of the app**, on a chunk a reader never loads.
- **2026-09-27: uploads are polled sooner, and 2026-09-27: an admin can reorder a day album.** Admin-only code and an `order` flag; a reader's page is unchanged.
- **2026-09-27: the app has no service worker.** The AWS app's precaches every file of the build on a first visit into a cache its fetch handler never reads. Here everything is on one host, so those 82 to 104 High-priority requests held the album's Low-priority thumbnails back 400 to 760 ms after the JSON had arrived; on AWS the thumbnails have a host of their own. Neither site had an offline page, and Add to Home Screen uses the manifest, which stays.
- **2026-09-28: a new album name is checked against the server alone**, one HEAD request on an admin's submit.
- **2026-09-28: a release keeps the app's file names when the app has not changed**, by naming the build from a hash of its inputs rather than the time; until then every release renamed about 60 of 75 JS files.
- **2026-09-28: a day album fetches the photo page's code on its load event**, behind the thumbnails, where it was fetched on the first click, 120 to 183 ms in a fresh browser; AWS's service worker had precached it.
- **2026-09-28: less of the app loads before a page's own code.** `shared/` is marked side-effect free, so the JS the page preloads fell from 46.7 to 43.9 KB gzipped and valibot loads with the album page.
- **2026-09-28: a day album fetches its first photo once the page has loaded**, since a reader's first click is usually the first thumbnail. A first photo cost 103 to 190 ms at every median but the cached California cold cell's 341, against 33 to 46 for the later photos the photo page had already fetched; the difference is the photo's own request, 131 KB for the comparison album's first photo against 16 to 18 per thumbnail, now spent on every album view whether or not the reader clicks. On a direct arrival the load event usually comes after the thumbnails; after an in-app navigation the fetch starts beside them, and `fetchpriority="low"` keeps it behind them in Chrome, Safari 17.2 and Firefox 132 on, while older browsers, iOS 15.6 among them, fetch it as they would a thumbnail.

## How it is measured

| Instrument                                          | What it measures                                                                                                                                                                                                                                                                                | What it cannot say                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| DebugBear browser runs (`api/scripts/debugbear.ts`) | The email reader's visit in real, headful Chrome from Paris, California and South Carolina, on both sites. The verdict. `requests <analysis id>` prints when one run's page, first script, album and first thumbnail requests started and ended, for reading a waterfall without the dashboard. | Louisiana: no location nearer than South Carolina. Only what the journey script times, per photo. |
| D1 rounds (`api/scripts/d1-round.ts`, Globalping)   | One first read of an album from a probe, repeats a second apart, then reads from a second location, by hand: what a colo's first contact with D1 costs against its next request, and when a replica takes over. Leave 20 minutes between rounds for the replicas to go inactive.                | Anything about a page: each request is on a fresh connection, with no page around it.             |
| The Worker's own headers (`x-d1`, `server-timing`)  | Where the Worker ran, how long it spent, and which D1 instance answered and how long it took.                                                                                                                                                                                                   | Anything outside the Worker.                                                                      |

### Browser runs

[DebugBear](https://www.debugbear.com) runs the visit in real Chrome with its window open, so connection hints, HTTP/3 and connection reuse behave as they do for readers.

- **Locations:** France (Paris), US West CA (California, which reaches Cloudflare in San Jose) and US East (South Carolina, standing in for Louisiana and Atlanta).
- **Device:** `Desktop unthrottled`, defined in the project with no added latency, bandwidth cap or CPU slowdown; the built-in `Desktop` adds 40 ms to every round trip.
- **Visit:** the `Vienna Journey` setting (in the appendix) waits for the page's load event and a reader's median 2.3 s on the album, records the album page's LCP as `album-lcp`, opens the first photo, then steps through seven more at 2.3 s each, recording each from click to photo decoded as `photo-01` to `photo-08`. DebugBear's own LCP measures a photo, since Chrome keeps updating LCP through a script's clicks.
- **Cold or warm site:** the report marks a run warm when the same page ran in the 30 minutes before it, so the round fifteen minutes after each cron slot is the warm one. Creating or editing a page starts a test of its own, which the report excludes by time.
- **Fresh or cached browser:** the `warm-browser` pages have Warm Load on with a setup flow that visits `/2025/09-29` first, so the browser holds the app's JS and nothing of the album. That visit wakes the site at that location seconds before the test, so a cached-browser run never meets a cold site; the fresh-browser cold runs keep that case. `add-warm-pages` creates the twins through the API; Warm Load and the flow are set by hand under each page's Show advanced.
- **Background traffic:** Grafana checks hit the AWS API and page from Paris, Ohio and Northern California; nothing else visits either site between rounds. Every merge to `main` releases production, whose checks reach the site a few times.

## What is known

- **The album JSON now arrives with the page's headers on both sites**, so what an album page waits on is the app's chunks. Without the service worker, Cloudflare's first thumbnail leaves 541 to 935 ms from the page's start against AWS's 777 to 825, 175 to 380 ms after the last chunk it needs, and is answered in about 70 ms against AWS's 370 or so for a thumbnail no edge held (2026-09-27).
- **A colo's first contact with D1 costs several round trips; a request after that costs one.** From Paris, a first album read after 22 idle minutes cost 355 to 652 ms of D1 wall time whether the read sent one statement or two and whether the primary was idle or awake; the second read 180 to 237, and from the second or third read on a European replica answered in 21 to 103 ms, then went inactive again within 22 minutes. SQL time was under 3 ms on every read. From San Jose a read costs 8 to 25 ms warm and about 70 after an idle gap. This is France's cold album page: after ten quiet hours on 2026-09-28 the album JSON took 893 ms and the album LCP 1,640 (2026-09-26 and 28).
- **The first cold round after a release runs on chunks no colo has cached.** The entry chunk took 207 ms in France two hours after a release and 87 sixteen minutes later; the chunks 165 against 112 at the median. Since 2026-09-28 a release renames the files only when the app changed (2026-09-27).
- **The service worker's precache held the thumbnails back**, 82 to 104 High-priority requests on the one host while the Low-priority thumbnails waited 400 to 760 ms after the JSON; removed on 2026-09-27 (see _Differences_).
- **Derived images:** the Worker answers a thumbnail or photo held in its colo's cache in 6 to 17 ms, and a colo kept an album's images for at least seven hours; a colo's first read from R2 in Western North America takes 250 to 550 ms from Paris or Baton Rouge, and Tiered Cache did not help (`docs/Risks.md` row 2).
- **Thumbnail bytes were metadata, not encoding:** the same 200x200 was 49 KB from the Worker and 34 from AWS with the pixels identical, an embedded preview on one side and EXIF on the other. Both sides are WebP now, within 10% of each other; the media page's image stays JPEG, since readers drag it into other apps (2026-09-26).
- **A cached browser skips the JS but not the shell.** The HTML shell is fetched on every navigation, an email link included; Cloudflare's says `must-revalidate` and costs a round trip of 20 to 50 ms, while a browser keeps AWS's copy and answers in 11 to 27.
- **The first photo waited on the browser until the immutable header.** Workers assets defaulted to `must-revalidate`, so the photo page's JS and CSS were checked before the photo's request, 26 to 86 ms; `web/static/_headers` gives `/_app/immutable/*` AWS's year-long header (2026-09-24).
- **AWS's own numbers:** a Lambda starting cold costs about 455 ms and met about three quarters of first requests after two idle minutes in early September, though later weeks suggest `GetAlbum` is held warm; CloudFront misses a chunk from Paris at about 280 ms and drops chunks from some edges within a day. Since 2026-09-27 its album page is an edge hit with the JSON preloaded, which took its page TTFB from 405 to 140 ms in France and 287 to 26 in California.

## Ruled out

- **Caching album JSON at the edge.** At this traffic most album views are the first of that page at that edge: a week of the AWS logs gives a 35 to 40% hit rate, and Cloudflare has more locations near the readers, so the same views split across more caches.
- **Sending the album read as one D1 request instead of two.** A first read from Paris costs 355 to 652 ms either way; a request costs one round trip whatever it holds. The batch stays, since a read is then one request to time and count.
- **Keep-warm traffic, replica keep-alive traffic, and a Worker placed beside D1.** Decided against: the first two are load for its own sake, and the last moves every request's first hop to San Jose.
- **Regenerating AWS's pre-fix derivatives** for the first comparison album; the comparison moved to a post-fix album instead.

## Open questions

- Whether a Durable Object in Western Europe holding the album JSON answers a cold Paris read in tens of milliseconds, against the 400 to 900 ms a colo's first contact with D1 costs today.
- What the cached-browser cells look like with the site cold as well, which DebugBear cannot measure, since its warm-up visit wakes the site; the fresh-browser cold rows bound it from above.

## Series notes

What touched production during the current series, so a round is read against it. Older series, on `/2025/09-29` with the app held to the AWS app, are in the git history of this file.

- **2026-09-26, 17:28 to 17:32 UTC:** `/2026/09-13/` imported into production; the rounds resumed at 19:23.
- **2026-09-27, 00:19 and 00:29 UTC:** AWS gained the edge-served album page and the JSON preload; 08:41, WebP thumbnails.
- **2026-09-27, 05:21 to 05:34 UTC:** a release and a re-import left the 05:24 round's Cloudflare pages with a 404 and the 05:39 round with cold caches; both left out.
- **2026-09-27, 20:29 UTC:** the service worker's removal released; the series above starts with the 22:23 round.
- **2026-09-28, 08:11 to 09:01 UTC:** three releases carried the stable chunk names, the photo-page prefetch and the bundle split, ahead of the 11:23 round.
- **2026-09-28, 19:24 UTC:** every Cloudflare run from California was slow while AWS's were as usual, page TTFB 130 to 252 ms against 65 to 77 in other rounds: the path from DebugBear's machine, not the site. Kept in the table.
- **2026-09-28, 21:06 UTC:** production moved to a Worker, database and buckets named for the environment, and only `/2025/09-29` was imported into it, so the 22:23 round's Cloudflare pages got a 404 and are left out. `/2026/09-13/` imported again at 00:33 UTC on the 29th.

## Appendix: the journey script

The `Vienna Journey` setting in DebugBear (named for the first comparison album and kept under that name), kept here because DebugBear's API can attach a setting to a page but not create or edit one; the selector on the `firstThumbnail` line names the comparison album:

```js
// DebugBear runs this as soon as the page starts loading. Once the album page has loaded and been looked at for a
// reader's median 2.3 s, open the first photo, then step through seven more at the same pace, timing each from the
// click or keypress until the new photo has loaded and decoded. The album page's own LCP is recorded as album-lcp
// before the first click, since Chrome keeps updating LCP through a script's clicks and would report the photo.
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
const firstThumbnail = await waitForElement('a[href^="/2026/09-13/"]');
const albumLcp = await new Promise((resolve) => {
    new PerformanceObserver((list) => resolve(list.getEntries().at(-1).startTime)).observe({
        type: 'largest-contentful-paint',
        buffered: true,
    });
});
performance.measure('album-lcp', { start: 0, end: albumLcp });
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
