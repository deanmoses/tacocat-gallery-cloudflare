/**
 * The site e2e tests run against, entirely local: the web app's build and the Worker, on a freshly migrated database
 * filled with the e2e gallery. Playwright starts and stops it.
 */
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { putLocalObject, startStack } from '../api/test/stack/start.ts';
import { E2E_PORT, ORIGINALS, seedGallery } from './gallery.ts';

// Emptied here rather than on exit, since wrangler ends the process on a signal before a handler of ours could run.
const STATE = fileURLToPath(new URL('../.wrangler/e2e', import.meta.url));
await rm(STATE, { recursive: true, force: true });

for (const { objectPath, file, contentType } of ORIGINALS) {
    await putLocalObject(STATE, objectPath, file, contentType);
}
const stack = await startStack({ port: E2E_PORT, persistTo: STATE });
const { origin } = await stack.url;
await seedGallery(origin);
console.log(`e2e site ready on ${origin}`);
