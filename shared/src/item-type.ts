import * as valibot from 'valibot';

/** What an item is: an album, or a media item of some kind. Code that treats every kind of media alike asks only this. */
export const itemTypeSchema = valibot.picklist(['album', 'media']);

/** Which kind of media a media item is. Only code that shows or processes media needs to know. */
export const mediaTypeSchema = valibot.picklist(['image', 'video']);

export type ItemType = valibot.InferOutput<typeof itemTypeSchema>;
export type MediaType = valibot.InferOutput<typeof mediaTypeSchema>;
