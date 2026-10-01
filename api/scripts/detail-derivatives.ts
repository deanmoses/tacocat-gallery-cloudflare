// Which objects in a derived bucket are JPEGs the Images binding wrote with the original's metadata still in them, from
// their keys alone. A media page image is named by its size alone, `1024` or `x1024`, smaller for a smaller original,
// with a crop after it when a URL asked for one; one a URL asked for as JPEG ends in `-jpeg`. A video's `video.mp4`
// and `poster.jpg` sit beside them under the same version, and the transcoder made those, so a key is taken only when
// its name is one of the two shapes exactly. A GIF's or a PNG's media page image is named the same way and is WebP,
// with nothing in it, but taking it costs no more than one transformation to make it again. Nothing here touches the
// network or the disk, so a test can hold it still.
import { isVersionId } from '@tacocat-gallery/shared';

const DETAIL_NAME = /^x?[1-9]\d*(?:-[\d,.]+)?$/v;

export function isMetadataJpeg(key: string): boolean {
    const [root, versionId, name, ...rest] = key.split('/');
    return (
        root === 'derived' &&
        versionId !== undefined &&
        isVersionId(versionId) &&
        name !== undefined &&
        rest.length === 0 &&
        (DETAIL_NAME.test(name) || name.endsWith('-jpeg'))
    );
}
