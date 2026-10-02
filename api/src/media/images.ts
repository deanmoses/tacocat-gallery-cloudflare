import { type ImageRequest, type ImageSize, THUMBNAIL_SIZE_2X, cropText, sizeText } from '@tacocat-gallery/shared';

export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Every format a derivative is written in, with Image Transformations' name for it; anything else asked for gets the
 * default. GIF is not among them, since Image Transformations write a GIF only from a GIF.
 */
const OUTPUT_FORMATS = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
} as const;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

/**
 * Where a cover crop is centred when the URL brings no crop of its own: halfway across and a third of the way down,
 * where a standing person's face is likelier to be than in the middle. The AWS image CDN centred every thumbnail
 * nobody had recut on that point, so the gallery's thumbnails keep the framing they have had for years; `box-center`
 * is the mode that centres the cut on the point rather than aligning proportions.
 */
const DEFAULT_FOCUS = { x: 0.5, y: 1 / 3, mode: 'box-center' } as const;

const HEIC_TYPES: ReadonlySet<string> = new Set(['image/heic', 'image/heif']);

/** Whether a content type is a HEIC or HEIF, which only Safari can show. */
export function isHeicType(contentType: string): boolean {
    return HEIC_TYPES.has(contentType);
}

const WEBP_SOURCES: ReadonlySet<string> = new Set(['image/gif', 'image/png']);

/** What an image URL asks for, the format it gets, and where its derivative and the sources it is made from are. */
export interface Derivation {
    request: ImageRequest;
    /** Null when the source's content type decides the format. */
    format: OutputFormat | null;
    /** The derivative, in the derived bucket. */
    key: string;
    /** The version's poster in the derived bucket, which a video has and a photo does not. */
    poster: string;
    /** The version's file as uploaded, in the originals bucket. */
    original: string;
}

export interface Derivative {
    body: Uint8Array<ArrayBuffer> | ReadableStream;
    contentType: string;
    how: 'stored' | 'generated';
}

/**
 * The codes Cloudflare's docs give for a fault in the file: not an image (9412), over 100 megapixels (9413), and a
 * format it does not take (9520). Image Transformations and the Images binding share them. Any other code is taken as
 * the service failing to run, since taking a busy service for a bad file gives the file up, where the other mistake
 * costs only another try: 9502, 9522, 9527 and 9529 all came from the binding while it was busy, and images that had
 * failed with 9527 were made on a later request. A HEIC written by macOS `sips` gets 9516, which the docs call
 * internal, every time, so it is tried again in vain.
 */
const FILE_FAULTS: ReadonlySet<number> = new Set([9412, 9413, 9520]);

/** Whether the image itself was refused, as against the service failing to run, which a later try may get past. */
export function isRefusal(error: unknown): error is Error {
    if (!(error instanceof Error)) {
        return false;
    }
    const code =
        'code' in error && typeof error.code === 'number'
            ? error.code
            : Number(/^IMAGES_TRANSFORM_ERROR (?<code>\d+)/v.exec(error.message)?.groups?.['code']);
    return FILE_FAULTS.has(code);
}

/** A transformation Image Transformations did not make, with the code its `cf-resized` header gave, if any. */
class TransformationError extends Error {
    readonly code: number | null;

    constructor(code: number | null, message: string) {
        super(message);
        this.name = 'TransformationError';
        this.code = code;
    }
}

/** What a resize sets, in terms both engines share. */
type Resize = Pick<ImageTransform, 'width' | 'height' | 'fit' | 'gravity'>;

/** One image made from another, in the terms both engines take. */
export interface Transformation {
    trim: { left: number; top: number; width: number; height: number } | null;
    resize: Resize | null;
    output: ImageOutputOptions & { format: OutputFormat };
}

/**
 * The image at `url` made by Image Transformations, which fetch it themselves. A response that is not the image
 * transformed is thrown, whatever its status, since a source fetched but not transformed would otherwise be stored as
 * its own derivative: Cloudflare marks every transformation, made or not, with a `cf-resized` header, and a failed
 * one with its code there. `name` says which image it was in the error. The output carries no metadata, which a JPEG
 * would otherwise keep its copyright of; WebP never carries any.
 */
export async function throughTransformations(
    url: string,
    name: string,
    { trim, resize: resized, output }: Transformation,
): Promise<Uint8Array<ArrayBuffer>> {
    const image: RequestInitCfPropertiesImage = {
        ...(trim !== null && { trim }),
        ...resized,
        format: OUTPUT_FORMATS[output.format],
        metadata: 'none',
        ...(output.quality !== undefined && { quality: output.quality }),
        ...(output.anim !== undefined && { anim: output.anim }),
    };
    const response = await fetch(url, { cf: { image } });
    const marked = response.headers.get('cf-resized');
    const code = /err=(?<code>\d+)/v.exec(marked ?? '')?.groups?.['code'];
    if (!response.ok || marked === null || code !== undefined) {
        await response.body?.cancel();
        throw new TransformationError(
            code === undefined ? null : Number(code),
            `Image Transformations made nothing of ${name}: HTTP ${String(response.status)}, cf-resized ${marked ?? 'missing'}`,
        );
    }
    return new Uint8Array(await response.arrayBuffer());
}

/** The image `source` streams made by the Images binding. */
export async function throughBinding(
    images: ImagesBinding,
    source: ReadableStream,
    { trim, resize: resized, output }: Transformation,
): Promise<Uint8Array<ArrayBuffer>> {
    let transformer = images.input(byteStream(source));
    if (trim !== null) {
        transformer = transformer.transform({ trim });
    }
    if (resized !== null) {
        transformer = transformer.transform(resized);
    }
    const made = await transformer.output(output);
    return new Uint8Array(await made.response().arrayBuffer());
}

/**
 * The resize a request asks for. Both sides given means the image is cut to cover them, from the default focus unless
 * the request brought its own crop, which has chosen the frame already; one side means it is scaled to that side and
 * never enlarged.
 */
export function resize({ size: { width, height }, crop }: ImageRequest): Resize {
    return width !== null && height !== null
        ? { width, height, fit: 'cover', ...(crop === null && { gravity: DEFAULT_FOCUS }) }
        : { ...(width !== null && { width }), ...(height !== null && { height }), fit: 'scale-down' };
}

/**
 * How a derivative is encoded. A thumbnail, which asks for both sides, is one frame whatever the source: an album page
 * of animated GIFs would be a wall of motion, and both engines animate by default. The 2x WebP thumbnail
 * alone is encoded softer, for the reasons measured in https://github.com/deanmoses/tacocat-gallery-cloudflare/issues/81.
 */
export function outputOptions(format: OutputFormat, size: ImageSize): ImageOutputOptions & { format: OutputFormat } {
    const thumbnail = size.width !== null && size.height !== null;
    const softer =
        format === 'image/webp' && size.width === THUMBNAIL_SIZE_2X.width && size.height === THUMBNAIL_SIZE_2X.height;
    return { format, quality: softer ? 75 : 85, ...(thumbnail && { anim: false }) };
}

/**
 * The format a URL settles: the one its `format` parameter asks for, when it is one a derivative is written in, and
 * otherwise WebP for a thumbnail, which asks for both sides, since every browser the app supports shows it; null for an
 * image asked for by one side, the media page's, since its source decides. A JPEG from the binding carries the
 * original's IPTC and XMP blocks whole and most of its EXIF, GPS position included, whatever its `metadata` option is
 * set to, until `generateDerivative` strips them; its WebP carries nothing.
 */
export function outputFormat(requested: string | null, size: ImageSize): OutputFormat | null {
    const asked = Object.keys(OUTPUT_FORMATS).find((known): known is OutputFormat => known === requested);
    if (asked !== undefined) {
        return asked;
    }
    return size.width !== null && size.height !== null ? 'image/webp' : null;
}

/**
 * The format of an image asked for by one side whose URL names none: WebP for a GIF or a PNG, as the AWS site made
 * them, since it keeps a GIF's frames and a PNG's transparency; JPEG for a photo or a video's poster, since readers
 * drag the media page's image into other apps, most of which cannot open a WebP.
 */
export function formatForSource(contentType: string | undefined): OutputFormat {
    return contentType !== undefined && WEBP_SOURCES.has(contentType) ? 'image/webp' : 'image/jpeg';
}

/**
 * What a derivative is called under its version: the size, crop and the format the URL settles, spelled from the same
 * text as the URL so that it is found again only by a URL spelled the same way. One whose source decides its format
 * has none in its name.
 */
export function derivativeName(request: ImageRequest, format: OutputFormat | null): string {
    const cropped = request.crop === null ? '' : `-${cropText(request.crop)}`;
    const typed = format === null ? '' : `-${format.split('/', 2)[1] ?? ''}`;
    return `${sizeText(request.size)}${cropped}${typed}`;
}

/**
 * R2 bodies and Blob streams are typed ReadableStream<any>, which the Images binding refuses. workerd's identity
 * stream passes the bytes through unchanged and is typed as yielding Uint8Array.
 */
export function byteStream(stream: ReadableStream): ReadableStream<Uint8Array> {
    return stream.pipeThrough(new IdentityTransformStream());
}
