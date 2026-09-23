import { albumPath, mediaPath } from 'tacocat-gallery-shared';
import { loadMedia } from '$lib/album';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) =>
    loadMedia(fetch, mediaPath(albumPath(albumPath('/', params.year), params.day), params.media));
