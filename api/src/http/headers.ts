/**
 * What every response from this site carries. The crawler half asks: the site is nobody's to index or train on. The
 * security half the browser enforces. The app's own files never reach the Worker, so web/static/_headers repeats
 * these for the asset router, and a stack test holds the two copies together.
 */
export const SITE_HEADERS = {
    // Reaches what the app's meta tag cannot: images, JSON, and crawlers that skip the body. No nofollow: crawlers
    // reach deep routes by following links, which is how the noindex gets to pages already indexed. noai and
    // noimageai are a DeviantArt convention Google does not document, kept because they cost nothing.
    'x-robots-tag': 'noindex, noimageindex, nosnippet, max-image-preview:none, notranslate, noarchive, noai, noimageai',
    // W3C TDMRep: EU DSM Article 4 allows commercial text and data mining unless reserved by machine-readable means.
    'tdm-reservation': '1',
    // No preload: joining the browsers' list is the one step here that cannot be undone on our own timetable.
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    // DENY: the app has no iframes, and framing the gallery elsewhere is the one reuse a browser will block for us.
    'x-frame-options': 'DENY',
    // Leaves out autoplay, which the video player needs, and fullscreen, which a gallery viewer may grow.
    'permissions-policy':
        'accelerometer=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
} as const;

/** On the media routes as well: another site cannot embed the photos, and the app is the same site as they are. */
export const MEDIA_HEADERS = { 'cross-origin-resource-policy': 'same-site' } as const;
