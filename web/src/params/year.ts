import type { ParamMatcher } from '@sveltejs/kit';
import { isYearName } from 'tacocat-gallery-shared';

export const match: ParamMatcher = isYearName;
