/** A title for a media item that has none, made from its name: `felix_at_the_beach_1` is shown as `Felix At The Beach`. */
export function titleFromName(name: string): string {
    return name
        .replaceAll(/[-_]/gu, ' ') // - and _ to space
        .replace(/\d[A-Za-z]$/u, '') // remove numbers like '1b'
        .replaceAll(/\d/gu, '') // remove every other number
        .replaceAll(/(?:^|\s)\w/gu, (letter) => letter.toUpperCase()) // capitalize each word
        .trim(); // to handle names like image_1, which will have trailing spaces
}
