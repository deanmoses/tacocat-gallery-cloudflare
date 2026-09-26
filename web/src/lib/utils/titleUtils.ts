export function toTitleFromFilename(filename: string): string {
    return filename
        .replace(/\.[^.]*$/u, '') // remove extension
        .replaceAll(/[-_]/gu, ' ') // - and _ to space
        .replace(/\d[A-Za-z]$/u, '') // remove numbers like '1b'
        .replaceAll(/\d/gu, '') // remove every other number
        .replaceAll(/(?:^|\s)\w/gu, (letter) => letter.toUpperCase()) // capitalize each word
        .trim(); // to handle files like image_1.jpg, which will have trailing spaces
}
