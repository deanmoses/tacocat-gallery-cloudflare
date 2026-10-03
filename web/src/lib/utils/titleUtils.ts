/**
 * Names a camera or phone gives a file, such as `img_3598`, `pxl_20260809_231544272`,
 * `vid_20251115_141507` or `whatsapp_image_2026_09_01_at_14_15_52`. The digit is
 * required because real names share the prefixes: `pickleball`, `photos`, `pix_by_mikek01`.
 */
const CAMERA_NAME = /^(?:(?:dsc|dscf|dscn|gopr|image|img|img_e|mvi|photo|pic|pix|pxl|vid)_?\d|whatsapp_image_)/u;

/** A title for a media item that has none, made from its name: `felix_at_the_beach_1` is shown as `Felix At The Beach`. */
export function titleFromName(name: string): string {
    if (CAMERA_NAME.test(name)) return '';
    return name
        .replaceAll(/[-_]/gu, ' ') // - and _ to space
        .replace(/\d[A-Za-z]$/u, '') // remove numbers like '1b'
        .replaceAll(/\d/gu, '') // remove every other number
        .replaceAll(/(?:^|\s)\w/gu, (letter) => letter.toUpperCase()) // capitalize each word
        .trim(); // to handle names like image_1, which will have trailing spaces
}
