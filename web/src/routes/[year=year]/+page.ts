import { albumPath } from 'tacocat-gallery-shared';
import { loadAlbum, loadParent } from '$lib/album';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
    const path = albumPath('/', params.year);
    // Not awaited: the page shows without its parent, which only its prev and next links come from.
    const parent = loadParent(fetch, path);
    return { album: await loadAlbum(fetch, path), parent };
};
