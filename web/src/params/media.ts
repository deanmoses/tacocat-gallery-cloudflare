import { isMediaName } from 'tacocat-gallery-shared';

export function match(param: string): boolean {
    return isMediaName(param);
}
