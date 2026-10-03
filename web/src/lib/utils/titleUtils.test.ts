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
    // to them and any single letter trailing the last of them: sequence
    // numbers are noise in a title, not part of the name
    { name: 'beach1', title: 'Beach' },
    { name: 'beach10', title: 'Beach' },
    { name: 'beach_1', title: 'Beach' },
    { name: 'beach1b', title: 'Beach' },
    { name: '1love', title: 'Love' },

    // Names that survive the digit rules with nothing left. A dated export is
    // the realistic way to reach the empty title, and the caller has no
    // fallback behind it: the media item is displayed unnamed.
    { name: '2024', title: '' },
    { name: '', title: '' },

    // A name a camera or phone gave says nothing a title could, so the media
    // item is displayed unnamed rather than as "Img" or "Pxl"
    { name: 'img_3598', title: '' },
    { name: 'img3598', title: '' },
    { name: 'img_20251115_141507', title: '' },
    { name: 'pxl_20260809_231544272', title: '' },
    { name: 'pxl_20260809_231544272_mp', title: '' },
    { name: 'photo_004', title: '' },
    { name: 'dsc_0042', title: '' },
    { name: 'dscn0042', title: '' },
    { name: 'image_1', title: '' },
    { name: 'pic_2', title: '' },
    { name: 'pix01', title: '' },
    { name: 'whatsapp_image_2026_09_01_at_14_15_52', title: '' },
    { name: 'img_e3598', title: '' },
    { name: 'dscf1234', title: '' },
    { name: 'vid_20251115_141507', title: '' },
    { name: 'mvi_1234', title: '' },
    { name: 'gopr0123', title: '' },

    // Real names that share a camera's prefix, kept because no digit follows it
    { name: 'pickleball', title: 'Pickleball' },
    { name: 'picking_apples1', title: 'Picking Apples' },
    { name: 'photos', title: 'Photos' },
    { name: 'photo_ladies1', title: 'Photo Ladies' },
    { name: 'pix_by_mikek01', title: 'Pix By Mikek' },
    { name: 'imagine', title: 'Imagine' },
    { name: 'video1', title: 'Video' },
    { name: 'img_edit', title: 'Img Edit' },
];

describe(titleFromName, () => {
    it.each(CASES)('[$name] is titled [$title]', ({ name, title }) => {
        expect(titleFromName(name)).toBe(title);
    });
});
