import { describe, expect, it } from 'vitest';
import { titleFromName } from './titleUtils';

/**
 * A media item with no title of its own is displayed under one made from its
 * name, which the sanitizer made from whatever a camera, a phone or an export
 * wrote.
 */
const CASES: { name: string; title: string }[] = [
    { name: 'image', title: 'Image' },

    // Underscores separate words
    { name: 'two_words', title: 'Two Words' },
    { name: 'three_whole_words', title: 'Three Whole Words' },
    { name: 'my_photo_1', title: 'My Photo' },

    // Digits are dropped wherever they sit, along with the separator that led
    // to them and any single letter trailing the last of them: the sequence
    // numbers a camera adds are noise in a title, not part of the name
    { name: 'image1', title: 'Image' },
    { name: 'image10', title: 'Image' },
    { name: 'image_1', title: 'Image' },
    { name: 'image1b', title: 'Image' },
    { name: 'img_1234', title: 'Img' },
    { name: '1love', title: 'Love' },

    // Names that survive the digit rules with nothing left. A dated export is
    // the realistic way to reach the empty title, and the caller has no
    // fallback behind it: the media item is displayed unnamed.
    { name: '2024', title: '' },
    { name: '', title: '' },
];

describe(titleFromName, () => {
    it.each(CASES)('[$name] is titled [$title]', ({ name, title }) => {
        expect(titleFromName(name)).toBe(title);
    });
});
