import type { ItemWrite } from 'tacocat-gallery-shared';
import { adminCookie } from '../api/test/secrets.ts';

export const E2E_PORT = 8790;

const YEAR_PATH = '/2001/';
const DAY_PATH = '/2001/06-15/';
const NEXT_DAY_PATH = '/2001/07-04/';

/** The year the admin journeys create, rename and delete albums in; the reader journeys never open it. */
export const ADMIN_YEAR_PATH = '/2003/';
/** The day album the admin journeys upload into, holding the one photo they caption, crop and replace. */
export const ADMIN_DAY_PATH = '/2003/08-01/';
export const ADMIN_PHOTO_PATH = `${ADMIN_DAY_PATH}photo.jpg`;
/** A second photo in that day, so one of the two is always not the day's thumbnail and can be made it. */
export const ADMIN_SECOND_PHOTO_PATH = `${ADMIN_DAY_PATH}second.jpg`;
const ADMIN_PHOTO_VERSION = 'e2e-photo';

/**
 * The gallery every e2e test starts from, written once when the server starts. Tests read it and never change it, since
 * they share one server and run in parallel; a test that writes makes an album of its own, in the admin year. The
 * photos are rows alone, with no file behind them, but for the admin photo, whose original ORIGINALS puts into local
 * R2 so its thumbnail can be cut: R2 event notifications, which carry an upload into the gallery, have no local
 * stand-in, so a test asserts which image the page asks for rather than that it arrived.
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
    adminYear: { parentPath: '/', itemName: '2003', itemType: 'album', published: true },
    adminDay: { parentPath: ADMIN_YEAR_PATH, itemName: '08-01', itemType: 'album', published: true },
    adminPhoto: {
        parentPath: ADMIN_DAY_PATH,
        itemName: 'photo.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Photo',
        versionId: ADMIN_PHOTO_VERSION,
        width: 4032,
        height: 3024,
    },
    adminSecondPhoto: {
        parentPath: ADMIN_DAY_PATH,
        itemName: 'second.jpg',
        itemType: 'media',
        mediaType: 'image',
        title: 'Second',
        versionId: 'e2e-second',
        width: 4032,
        height: 3024,
    },
} as const satisfies Record<string, ItemWrite>;

/** The files behind the gallery's photos, as `<bucket>/<key>` in the media bucket the Worker's top-level config names. */
export const ORIGINALS = [
    {
        objectPath: `tacocat-staging-media/originals/${ADMIN_PHOTO_VERSION}`,
        file: 'fixtures/FullMetadata.jpg',
        contentType: 'image/jpeg',
    },
] as const;

/**
 * An album that answers only once the rest of the gallery is written, since it is written last: the server is ready
 * when this stops being a 404.
 */
export const READY_PATH = `/api/album${NEXT_DAY_PATH}`;

/** Writes the gallery through the Worker's own API, as an admin would. */
export async function seedGallery(origin: string): Promise<void> {
    const { nextDay, ...rest } = GALLERY;
    await Promise.all(Object.values(rest).map(async (item) => putItem(origin, item)));
    await setThumbnail(origin, ADMIN_DAY_PATH, ADMIN_PHOTO_PATH);
    await putItem(origin, nextDay);
}

async function setThumbnail(origin: string, albumPath: string, mediaPath: string): Promise<void> {
    const response = await fetch(new URL(`/api/album-thumb${albumPath}`, origin), {
        method: 'PATCH',
        headers: { cookie: await adminCookie() },
        body: JSON.stringify({ mediaPath }),
    });
    if (!response.ok) {
        throw new Error(`setting ${albumPath}'s thumbnail failed: ${response.status} ${await response.text()}`);
    }
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
