import { isMediaName } from '@tacocat-gallery/shared';

/** A media name, or one with an extension as the URLs had them until 2026: the page sends those on to the name without it. */
export function match(param: string): boolean {
    return isMediaName(param) || param.includes('.');
}
