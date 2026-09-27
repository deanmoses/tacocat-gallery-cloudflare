/** A year or day album's name as typed: digits and single hyphens, which is all either is made of. */
export function sanitizeAlbumName(albumName: string): string {
    return albumName
        .replaceAll(/[A-Za-z]+/gu, '') // letters to nothing
        .replaceAll(/[^\-0-9]+/gu, '-') // any other invalid chars to -
        .replaceAll(/-+/gu, '-') // multple - to single -
        .replaceAll(/^-/gu, ''); // remove leading -
}
