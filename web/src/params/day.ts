import { isDayName } from '@tacocat-gallery/shared';

export function match(param: string): boolean {
    return isDayName(param);
}
