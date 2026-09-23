import { loadAlbum } from '$lib/album';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => ({ album: await loadAlbum(fetch, '/') });
