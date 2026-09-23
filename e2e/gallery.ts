import type { ItemWrite } from 'tacocat-gallery-shared';
import { adminCookie } from '../api/test/secrets.ts';

export const E2E_PORT = 8790;

/**
 * The gallery every e2e test starts from, written once when the server starts. Tests read it and never change it, since
 * they share one server and run in parallel; a test that writes makes an album of its own.
 */
const GALLERY = {
    year: { parentPath: '/', itemName: '2001', itemType: 'album', published: true },
    day: { parentPath: '/2001/', itemName: '06-15', itemType: 'album', title: 'Felix turns one', published: true },
    nextDay: { parentPath: '/2001/', itemName: '07-04', itemType: 'album', published: true },
    cake: {
        parentPath: '/2001/06-15/',
        itemName: 'cake.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Cake',
        versionId: 'v1',
        width: 4032,
        height: 3024,
    },
    felix: {
        parentPath: '/2001/06-15/',
        itemName: 'felix.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Felix',
        versionId: 'v1',
        width: 4032,
        height: 3024,
    },
} as const satisfies Record<string, ItemWrite>;

/**
 * An album that answers only once the rest of the gallery is written, since it is written last: the server is ready
 * when this stops being a 404.
 */
export const READY_PATH = '/api/album/2001/07-04/';

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
