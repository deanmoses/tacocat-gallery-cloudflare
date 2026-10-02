// Removes the service worker the AWS app installed on this hostname. Nothing registers this file: a browser that holds
// the old worker fetches it as that worker's update, and this replaces it, then deletes its caches and unregisters. Its
// update check would otherwise get the app's fallback page, which fails on its content type, and keep the old worker.
addEventListener('install', (event) => {
    event.waitUntil(skipWaiting());
});

// Unregisters even when a cache will not delete: the script is the same on every later update check, so the browser
// never installs it again to retry, and the registration would stay for good.
async function retire() {
    try {
        const names = await caches.keys();
        await Promise.all(names.map(async (name) => caches.delete(name)));
    } finally {
        await registration.unregister();
    }
}

addEventListener('activate', (event) => {
    event.waitUntil(retire());
});
