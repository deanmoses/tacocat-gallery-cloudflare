import type { PageLoad } from './$types';
import { sameSitePath } from '$lib/utils/returnPath';

export const load = (({ url }): { returnPath: string } => ({
    returnPath: sameSitePath(url.searchParams.get('returnPath'), url.origin),
})) satisfies PageLoad;
