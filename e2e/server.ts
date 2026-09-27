/**
 * The site e2e tests run against, entirely local: the web app's build and the Worker, on a freshly migrated database
 * filled with the e2e gallery. Playwright starts and stops it.
 */
import { rm } from 'node:fs/promises';
import { putLocalObject, startStack } from '../api/test/stack/start.ts';
import { E2E_ORIGIN, E2E_PORT, E2E_STATE, ORIGINALS, seedGallery } from './gallery.ts';

// Emptied here rather than on exit, since wrangler ends the process on a signal before a handler of ours could run.
await rm(E2E_STATE, { recursive: true, force: true });

for (const { objectPath, file, contentType } of ORIGINALS) {
    await putLocalObject(E2E_STATE, objectPath, file, contentType);
}
// Uploads complete locally, as under `wrangler dev`: the Worker takes the PUT and raises the event itself. A passkey is
// bound to the site's origin, which here is the e2e port, and the Worker has to see it as the browser sent it.
const stack = await startStack({
    port: E2E_PORT,
    persistTo: E2E_STATE,
    vars: { UPLOADS: 'local', SITE_ORIGIN: E2E_ORIGIN },
    localUpstream: true,
});
const { origin } = await stack.url;
await seedGallery(origin);
console.log(`e2e site ready on ${origin}`);
