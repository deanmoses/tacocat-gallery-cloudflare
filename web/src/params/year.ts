import { isYearName } from '@tacocat-gallery/shared';

export function match(param: string): boolean {
    return isYearName(param);
}
