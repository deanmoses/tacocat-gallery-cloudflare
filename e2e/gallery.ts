import { fileURLToPath } from 'node:url';
import type { ItemWrite } from '@tacocat-gallery/shared';
import { testVersionId } from '@tacocat-gallery/api/test/version-id';
import { putItem } from './api.ts';

export const E2E_PORT = 8790;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/** Where the e2e site keeps D1 and R2, emptied each time its server starts. */
export const E2E_STATE = fileURLToPath(new URL('../.wrangler/e2e', import.meta.url));

const YEAR_PATH = '/2001/';
const DAY_PATH = '/2001/06-15/';
const NEXT_DAY_PATH = '/2001/07-04/';

/** The reader's two photos, each under its own version, so a test can spell the URL the media page asks for. */
export const READER_PHOTOS = {
    cake: { path: `${DAY_PATH}cake`, versionId: testVersionId('v1') },
    felix: { path: `${DAY_PATH}felix`, versionId: testVersionId('v2') },
} as const;

/**
 * The gallery the reader journeys walk, written once when the server starts. Tests share one server and run in
 * parallel, so no test changes it; an admin journey writes into a year of its own instead, which adds a year to the
 * root for as long as the server runs, so a test asserts no list of years. The photos are rows whose
 * file `server.ts` puts straight into local R2, the same file under each one's version id, so that the photo the
 * reader opens can load. A test that needs an item the upload pipeline made, with its original and derivatives,
 * uploads one: the site runs with `UPLOAD_MODE=local`, so an upload becomes an item as it would deployed.
 */
const GALLERY = {
    year: { parentPath: '/', itemName: '2001', itemType: 'album', published: true },
    day: { parentPath: YEAR_PATH, itemName: '06-15', itemType: 'album', summary: 'Felix turns one', published: true },
    // The day's newer neighbour, for its prev and next links.
    nextDay: { parentPath: YEAR_PATH, itemName: '07-04', itemType: 'album', published: true },
    cake: {
        parentPath: DAY_PATH,
        itemName: 'cake',
        itemType: 'media',
        mediaType: 'image',
        title: 'Cake',
        versionId: READER_PHOTOS.cake.versionId,
        width: 4032,
        height: 3024,
    },
    // Portrait, so its detail image is sized by its height.
    felix: {
        parentPath: DAY_PATH,
        itemName: 'felix',
        itemType: 'media',
        mediaType: 'image',
        title: 'Felix',
        versionId: READER_PHOTOS.felix.versionId,
        width: 3024,
        height: 4032,
    },
} as const satisfies Record<string, ItemWrite>;

/** The files behind the gallery's photos, as `<bucket>/<key>` in the originals bucket the Worker's top-level config names. */
export const ORIGINALS = [GALLERY.cake, GALLERY.felix].map(({ versionId }) => ({
    objectPath: `staging-originals/originals/${versionId}`,
    file: fileURLToPath(import.meta.resolve('@tacocat-gallery/api/fixtures/FullMetadata.jpg')),
    contentType: 'image/jpeg',
}));

/**
 * An album that answers only once the rest of the gallery is written, since it is written last: the server is ready
 * when this stops being a 404.
 */
export const READY_PATH = `/api/album${NEXT_DAY_PATH}`;

/** Writes the gallery through the Worker's own API, as an admin would. */
export async function seedGallery(origin: string): Promise<void> {
    const { nextDay, ...rest } = GALLERY;
    await Promise.all(Object.values(rest).map(async (item) => putItem(origin, item)));
    await putItem(origin, nextDay);
}
