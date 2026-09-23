import { albumPath } from 'tacocat-gallery-shared';
import { loadAlbum } from '$lib/album';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => ({
    album: await loadAlbum(fetch, albumPath(albumPath('/', params.year), params.day)),
});
