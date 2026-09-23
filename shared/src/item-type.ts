import * as valibot from 'valibot';

const MEDIA_TYPES = ['image', 'video'] as const;

export const mediaTypeSchema = valibot.picklist(MEDIA_TYPES);

export const itemTypeSchema = valibot.picklist(['album', ...MEDIA_TYPES]);

export type ItemType = valibot.InferOutput<typeof itemTypeSchema>;
