// The `Vienna Journey` setting in DebugBear, named for the first comparison album and kept under that name. DebugBear's
// API can attach a setting to a page but not create or edit one, so a change here is pasted into the dashboard by hand.
// The selector on the `firstThumbnail` line names the comparison album.
//
// DebugBear runs this as soon as the page starts loading. Once the album page has loaded and been looked at for a
// reader's median 2.3 s, open the first photo, then step through seven more at the same pace, timing each from the
// click or keypress until the new photo has loaded and decoded. The album page's own LCP is recorded as album-lcp
// before the first click, since Chrome keeps updating LCP through a script's clicks and would report the photo.
const PHOTO = 'a[aria-label^="View full-size image"] img';
const DWELL_MS = 2300;
const PHOTOS = 8;

/** @param {number} ms */
async function sleep(ms) {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * @param {string} step
 * @param {string | null} previousSrc
 * @returns {Promise<string | null>}
 */
async function photoShown(step, previousSrc) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        /** @type {HTMLImageElement | null} */
        const img = document.querySelector(PHOTO);
        if (img && img.src !== previousSrc && img.complete && img.naturalWidth > 0) {
            try {
                await img.decode();
            } catch {
                // A photo replaced while it decodes rejects, but it had loaded, so it counts as shown.
            }
            performance.mark(`${step}-shown`);
            performance.measure(step, `${step}-start`, `${step}-shown`);
            return img.src;
        }
        await sleep(10);
    }
    performance.mark(`${step}-timeout`);
    return previousSrc;
}

/** @type {Promise<void>} */
const loaded = new Promise((resolve) => {
    if (document.readyState === 'complete') {
        resolve();
    } else {
        addEventListener(
            'load',
            () => {
                resolve();
            },
            { once: true },
        );
    }
});
await loaded;
await sleep(DWELL_MS);
const firstThumbnail = await waitForElement('a[href^="/2026/09-13/"]');
/** @type {number} */
const albumLcp = await new Promise((resolve) => {
    new PerformanceObserver((list) => {
        const latest = list.getEntries().at(-1);
        if (latest) {
            resolve(latest.startTime);
        }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
});
performance.measure('album-lcp', { start: 0, end: albumLcp });
performance.mark('photo-01-start');
firstThumbnail.click();
let src = await photoShown('photo-01', null);

for (let photo = 2; photo <= PHOTOS; photo++) {
    const step = `photo-${String(photo).padStart(2, '0')}`;
    await sleep(DWELL_MS);
    performance.mark(`${step}-start`);
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    src = await photoShown(step, src);
}
