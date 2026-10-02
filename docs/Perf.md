# Performance

How pix.tacocat.com's performance is measured, and what the measurements have said so far. A page is judged as its reader sees it, a whole page load in a real browser from a reader's region; the timing of a single request is for finding out why a page is slow, not whether it is, since it misses what a browser does with connection hints, HTTP/3 and connection reuse. The comparison with the AWS site that decided the move, and every measurement made against it, is in `docs/plans/migration_from_aws/PerfVsAws.md`.

## How readers use the site

An email goes out every week or so with the newest albums. A reader follows its link straight to a day album, clicks through its photos, and leaves; few start at the root or a year. The AWS site's logs for 2026-09-12 to 23, real visitors only, are the last count of it, and nothing about the readership has changed since:

- **57 album reads by 30 readers**, most of them on the newest three albums.
- **Photos outnumber album opens about ten to one:** 574 photo requests against 57 album reads. A reader gets a median of 5 photos and a quarter get 18 or more, counting the neighbours the app preloads; the newest album's readers got a median of 21.
- **Most photos are seen about once per edge**, so a photo's first byte is usually a bucket read, not a cache hit. The median gap between photos is 2.3 s.
- **The app preloads the next and previous photo**, so a click usually finds the photo already loading or loaded.

So the scenario that matters most is clicking from one photo to the next, and the album page is the one-off cost of arriving.

## Baseline

The last full series of browser runs, five rounds from 05:23 UTC on 2026-10-01 to 05:38 on the 2nd, on `/2026/09-13` with the whole gallery in production, as medians in ms; five runs make each median. A fresh browser holds nothing; a cached one holds the app's JS from a visit to another album seconds before, and nothing of this one. Cold is a site nobody had touched for hours; warm is the same page run within the half hour before. These ran against `pix.deanmoses.com`; production moved to `pix.tacocat.com` on 2026-10-02, with nothing cached at the edge for the new host, so the first rounds there will be a little slower than this until the colos have seen it.

| Browser | Site | Location       | Page TTFB | Album LCP | First photo | Later photos |
| ------- | ---- | -------------- | --------- | --------- | ----------- | ------------ |
| fresh   | cold | France         | 59        | 1,288     | 59          | 35           |
| fresh   | cold | California     | 61        | 1,036     | 70          | 34           |
| fresh   | cold | South Carolina | 86        | 892       | 68          | 34           |
| fresh   | warm | France         | 50        | 1,220     | 57          | 37           |
| fresh   | warm | California     | 70        | 892       | 61          | 38           |
| fresh   | warm | South Carolina | 86        | 1,064     | 74          | 32           |
| cached  | cold | France         | 23        | 692       | 65          | 36           |
| cached  | cold | California     | 19        | 616       | 66          | 36           |
| cached  | cold | South Carolina | 26        | 828       | 84          | 56           |
| cached  | warm | France         | 23        | 640       | 62          | 39           |
| cached  | warm | California     | 23        | 660       | 64          | 38           |
| cached  | warm | South Carolina | 27        | 652       | 69          | 43           |

- **Photos** are 57 to 84 ms for the first and 32 to 56 for the later ones, because the album page fetches the first photo once it has loaded and the media page fetches the neighbours.
- **The album page** in a fresh browser is where France pays: its first contact with D1 from Paris costs 350 to 1,010 ms for the album JSON (_What is known_).
- **A cached browser** still fetches the HTML shell on every navigation, an email link included; it is sent as `must-revalidate` and costs a round trip of 20 to 50 ms.
- **California** reached Cloudflare in Los Angeles or San Jose in this series, by the Worker's log of the album reads. In the series before, Google's network had handed the Los Angeles host to colos across the US and Europe, and its cells were slower by that; whether a reader on a Californian ISP is routed the same way is open.

## How it is measured

| Instrument                                          | What it measures                                                                                                                                                                                                                                                                 | What it cannot say                                                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DebugBear browser runs (`api/scripts/debugbear.ts`) | The email reader's visit in real, headful Chrome from Paris, California and South Carolina. The verdict. `requests <analysis id>` prints when one run's page, first script, album and first thumbnail requests started and ended, for reading a waterfall without the dashboard. | Louisiana: no location nearer than South Carolina. Only what the journey script times, per photo. Which colo its machine reached: the Worker's `album_read` log line says, and its request's `cf` fields give the machine's city and the round trip. |
| D1 rounds (`api/scripts/d1-round.ts`, Globalping)   | One first read of an album from a probe, repeats a second apart, then reads from a second location, by hand: what a colo's first contact with D1 costs against its next request, and when a replica takes over. Leave 20 minutes between rounds for the replicas to go inactive. | Anything about a page: each request is on a fresh connection, with no page around it.                                                                                                                                                                |
| The Worker's own headers (`x-d1`, `server-timing`)  | Where the Worker ran, how long it spent, and which D1 instance answered and how long it took.                                                                                                                                                                                    | Anything outside the Worker.                                                                                                                                                                                                                         |

### Browser runs

[DebugBear](https://www.debugbear.com) runs the visit in real Chrome with its window open, so connection hints, HTTP/3 and connection reuse behave as they do for readers. `DEBUGBEAR_API_KEY` in `api/.dev.vars` is the script's credential.

- **Locations:** France (Paris, which reaches Cloudflare there), US West CA (a Google Cloud host in Los Angeles, which reaches Cloudflare in Los Angeles or San Jose, or on some days colos across the US and Europe) and US East (South Carolina, which reaches Cloudflare in Atlanta, standing in for Louisiana). The machines are Google Cloud hosts, so they take Google's route to the site.
- **Device:** `Desktop unthrottled`, defined in the project with no added latency, bandwidth cap or CPU slowdown; the built-in `Desktop` adds 40 ms to every round trip.
- **Visit:** the `Vienna Journey` setting (in the appendix) waits for the page's load event and a reader's median 2.3 s on the album, records the album page's LCP as `album-lcp`, opens the first photo, then steps through seven more at 2.3 s each, recording each from click to photo decoded as `photo-01` to `photo-08`. DebugBear's own LCP measures a photo, since Chrome keeps updating LCP through a script's clicks.
- **Cold or warm site:** the report marks a run warm when the same page ran in the 30 minutes before it, so the second half of a round is the warm one. Creating or editing a page starts a test of its own, which the report excludes by time.
- **Fresh or cached browser:** the `warm-browser` pages have Warm Load on with a setup flow that visits `/2025/09-29` first, so the browser holds the app's JS and nothing of the album. That visit wakes the site at that location seconds before the test, so a cached-browser run never meets a cold site; the fresh-browser cold runs keep that case. `add-warm-pages` creates the twins through the API; Warm Load and the flow are set by hand under each page's Show advanced.
- **Background traffic:** every merge to `main` releases production, whose checks reach the site a few times. Nothing else visits the site between rounds.

### Running a series

- **The comparison album is `/2026/09-13`**, 21 photos. `node api/scripts/debugbear.ts pages` prints which album and host the pages test; `repoint` moves them to another album. The warm-browser setup flow visits `/2025/09-29`, which has to exist too.
- **The pages** are one per location for this site and a `warm-browser` twin of each. The AWS site's pages beside them stay until it is retired.
- **A round** is `node api/scripts/debugbear.ts run`, or the Browser performance runs workflow in the Actions tab: a cold run of every page, then a warm one. A series is several rounds hours apart, so each cold round finds the site quiet; the last scheduled series ran four a day, at 05:23, 11:23, 19:23 and 22:23 UTC. `node api/scripts/debugbear.ts report --from <date>` prints them. Nothing runs on a schedule now.
- **After anything that empties or rebuilds production**, check both albums are still there; a round that finds no album records nothing, and every image URL and edge cache is new afterwards.
- **A release** renames the app's files when the app changed, so the next cold round fetches every chunk from origin at every location; note a release that lands within a couple of hours of a round. While a series is running, hold releases or note them against it.

## What is known

What a number in a run usually means, from the measurements so far:

- **A colo's first contact with D1 costs several round trips; a request after that costs one.** From Paris, a first album read after 22 idle minutes cost 355 to 652 ms of D1 wall time whether the read sent one statement or two and whether the primary was idle or awake; the second read 180 to 237, and from the second or third read on a European replica answered in 21 to 103 ms, then went inactive again within 22 minutes. SQL time was under 3 ms on every read. From San Jose a read costs 8 to 25 ms warm and about 70 after an idle gap. This is France's cold album page: after ten quiet hours the album JSON took 893 ms and the album LCP 1,640. The primary is in SJC.
- **The read replicas rarely answer.** A replica wakes only when the same region reads again within seconds, and is inactive again 22 minutes later, while this site's normal reader arrives after an hour or more in which nobody has touched it.
- **Derived images:** the Worker answers a thumbnail or photo held in its colo's cache in 6 to 17 ms, and a colo kept an album's images for at least seven hours; a colo's first read from R2 in Western North America takes 250 to 550 ms from Paris or Baton Rouge, and Tiered Cache on an R2 custom domain did not help. At this traffic the first read is the usual case. A first-time transformation, made on the first request for a derivative, takes 0.44 to 0.87 s; the gallery copied from AWS had none of its derived images made, so an album's first reader since the copy waits on every thumbnail at once.
- **The first cold round after a release runs on chunks no colo has cached**, when the app changed: the entry chunk took 207 ms in France two hours after a release and 87 sixteen minutes later. A release that does not change the app keeps the file names.
- **A cached browser skips the JS but not the shell.** The HTML shell is fetched on every navigation, an email link included, and says `must-revalidate`, a round trip of 20 to 50 ms.
- **What an album page waits on is the app's chunks**, since the album JSON is preloaded from the page's headers. The first thumbnail leaves 541 to 935 ms from the page's start, 175 to 380 ms after the last chunk it needs.

## Ruled out

- **Caching album JSON at the edge.** At this traffic most album views are the first of that page at that edge: a week of the AWS logs gave a 35 to 40% hit rate, and Cloudflare has more locations near the readers, so the same views split across more caches.
- **Sending the album read as one D1 request instead of two.** A first read from Paris costs 355 to 652 ms either way; a request costs one round trip whatever it holds. The batch stays, since a read is then one request to time and count.
- **Keep-warm traffic, replica keep-alive traffic, and a Worker placed beside D1.** Decided against: the first two are load for its own sake, and the last moves every request's first hop to San Jose.

## Open questions

- Whether a Durable Object in Western Europe holding the album JSON answers a cold Paris read in tens of milliseconds, against the 400 to 900 ms a colo's first contact with D1 costs today.
- Whether a second derived bucket in WEUR would answer a colo's first read of an image from Paris faster than the 250 to 550 ms from WNAM.
- Whether a reader on a Californian ISP is routed to Los Angeles or San Jose or, as DebugBear's Google Cloud host in Los Angeles was on some days, to colos across the US and Europe; the `cf.colo` the Worker logs on an album read from a Globalping probe on such a network would say.
- What the cached-browser cells look like with the site cold as well, which DebugBear cannot measure, since its warm-up visit wakes the site; the fresh-browser cold rows bound it from above.
- Whether pre-generating the derived images of the copied gallery is worth about $36 once, so that no album's first reader since the copy waits on a burst of transformations (`docs/plans/migration_from_aws/AwsDataMigration.md`, _Pre-generate derived images_).

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
