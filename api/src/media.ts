/** Videos are told apart by extension; these four are every kind the gallery has ever held. */
export function isVideoName(name: string): boolean {
    return /\.(?:avi|m4v|mov|mp4)$/iv.test(name);
}
