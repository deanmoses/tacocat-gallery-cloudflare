import type { ParamMatcher } from '@sveltejs/kit';
import { isDayName } from 'tacocat-gallery-shared';

export const match: ParamMatcher = isDayName;
