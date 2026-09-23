import type { ParamMatcher } from '@sveltejs/kit';
import { isMediaName } from 'tacocat-gallery-shared';

export const match: ParamMatcher = isMediaName;
