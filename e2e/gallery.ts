import type { ItemWrite } from 'tacocat-gallery-shared';
import { adminCookie } from '../api/test/secrets.ts';

export const E2E_PORT = 8790;

const YEAR_PATH = '/2001/';
const DAY_PATH = '/2001/06-15/';
const NEXT_DAY_PATH = '/2001/07-04/';

/**
 * The gallery every e2e test starts from, written once when the server starts. Tests read it and never change it, since
 * they share one server and run in parallel; a test that writes makes an album of its own. The photos are rows alone,
 * with no file behind them: R2 event notifications, which carry an upload into the gallery, have no local stand-in,
 * so a test asserts which image the page asks for rather than that it arrived.
 */
const GALLERY = {
    year: { parentPath: '/', itemName: '2001', itemType: 'album', published: true },
    day: { parentPath: YEAR_PATH, itemName: '06-15', itemType: 'album', summary: 'Felix turns one', published: true },
    // The day's newer neighbour, for its prev and next links.
    nextDay: { parentPath: YEAR_PATH, itemName: '07-04', itemType: 'album', published: true },
    cake: {
        parentPath: DAY_PATH,
        itemName: 'cake.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Cake',
        versionId: 'v1',
        width: 4032,
        height: 3024,
    },
    // Portrait, so its detail image is sized by its height.
    felix: {
        parentPath: DAY_PATH,
        itemName: 'felix.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Felix',
        versionId: 'v1',
        width: 3024,
        height: 4032,
    },
} as const satisfies Record<string, ItemWrite>;

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

async function putItem(origin: string, item: ItemWrite): Promise<void> {
    const response = await fetch(new URL('/api/item', origin), {
        method: 'PUT',
        headers: { cookie: await adminCookie() },
        body: JSON.stringify(item),
    });
    if (!response.ok) {
        throw new Error(
            `writing ${item.parentPath}${item.itemName} failed: ${response.status} ${await response.text()}`,
        );
    }
}
