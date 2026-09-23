export function toTitleFromFilename(filename: string): string {
    return filename
        .replace(/\.[^.]*$/v, '') // remove extension
        .replaceAll(/[\-_]/gv, ' ') // - and _ to space
        .replace(/\d[A-Za-z]$/v, '') // remove numbers like '1b'
        .replaceAll(/\d/gv, '') // remove every other number
        .replaceAll(/(?:^|\s)\w/gv, (letter) => letter.toUpperCase()) // capitalize each word
        .trim(); // to handle files like image_1.jpg, which will have trailing spaces
}
