import {
    createExecutionContext,
    getQueueResult,
    introspectWorkflowInstance,
    waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import gifDataUrl from '../../fixtures/animated.gif?inline';
import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import noTagsDataUrl from '../../fixtures/NoTags.jpg?inline';
import pngDataUrl from '../../fixtures/pngFormat.png?inline';
import { eq } from 'drizzle-orm';
import { imageUrl, parsePresigned } from '@tacocat-gallery/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orm, schema } from '../../src/db';
import { CALL_LIMIT_MS } from '../../src/gallery/derivatives';
import { derivedPrefix, inboxKey, originalKey, posterKey, videoKey } from '../../src/storage/keys';
import { fixtureBytes } from '../gallery';
import { albumAsAdmin, call, callAsAdmin, handler, putDay, putItem, storedItem, uploadErrors, write } from '../helpers';
import { deliver, uploadBatch } from '../pipeline';
import { testVersionId } from '../version-id';

const jpg = fixtureBytes(jpgDataUrl);
const JPG_TAGS = ['halloween', 'dog', 'parade'];
const heic = fixtureBytes(heicDataUrl);
// A captioned JPEG with no keywords.
const noTags = fixtureBytes(noTagsDataUrl);
// 220 by 212, so it is not the size of the JPEG, which is 300 by 225.
const png = fixtureBytes(pngDataUrl);
// Two frames, 32 by 24.
const gif = fixtureBytes(gifDataUrl);

// A QuickTime movie's first box, which is all the sniffer reads and all the stand-in transcoder needs.
const mov = Uint8Array.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0]);

const DAY = '/2024/06-15/';
const IMAGE = { itemType: 'media', mediaType: 'image', width: 300, height: 225 } as const;

interface Staged {
    replace?: boolean;
    contentType?: string;
}

/**
 * Asks for an upload URL as the app does and puts the file in the inbox as the browser would, returning the version
 * id the upload was minted, ready for its event to be delivered.
 */
async function stage(path: string, file: Uint8Array, { replace, contentType }: Staged = {}): Promise<string> {
    const response = await write('POST', `/api/presigned${DAY}`, [
        { path, ...(replace === undefined ? {} : { replace }) },
    ]);
    if (!response.ok) {
        throw new Error(`presign refused: ${await response.text()}`);
    }
    const presigned = parsePresigned(await response.json())[path];
    if (presigned === undefined) {
        throw new Error(`nothing presigned for ${path}`);
    }
    await env.UPLOADS.put(inboxKey(presigned.versionId), file, {
        httpMetadata: { contentType: contentType ?? 'image/jpeg' },
    });
    return presigned.versionId;
}

/** The whole upload: staged and delivered. */
async function upload(path: string, file: Uint8Array, staged: Staged = {}): Promise<string> {
    const versionId = await stage(path, file, staged);
    await deliver(versionId);
    return versionId;
}

/** Stands the transcoder container in with something that answers every request with `respond`. */
function standInTranscoder(respond: (init?: RequestInit) => Promise<Response>): void {
    const stub = { fetch: async (_input: RequestInfo | URL, init?: RequestInit) => respond(init) };
    vi.spyOn(env.TRANSCODER, 'getByName').mockReturnValue(
        stub as unknown as ReturnType<typeof env.TRANSCODER.getByName>,
    );
}

/** What the container reports for a portrait iPhone clip: landscape frames with a quarter-turn display matrix. */
const TRANSCODED = { output: { codedWidth: 1920, codedHeight: 1080, rotation: -90, durationSeconds: 9.6 } };

async function rejecting(): Promise<Response> {
    return Response.json({ error: 'ffmpeg exited 1: moov atom not found' }, { status: 422 });
}

async function transcoding(): Promise<Response> {
    return Response.json(TRANSCODED);
}

/**
 * Stands the Images binding in with one that answers every transformation with the JPEG fixture. Miniflare's local
 * binding has no HEIF decoder, where the real one decodes an 8-bit HEIC, so a HEIC's derivatives cannot be made here.
 */
function decodingAnyImage(): void {
    const result = {
        response: () => new Response(jpg, { headers: { 'content-type': 'image/jpeg' } }),
    } as ImageTransformationResult;
    const transformer = {
        transform: (): ImageTransformer => transformer,
        output: async (): Promise<ImageTransformationResult> => result,
    } as unknown as ImageTransformer;
    vi.spyOn(env.IMAGES, 'input').mockReturnValue(transformer);
}

/** A promise nothing ever settles, as a call that hangs returns. */
async function never<T>(): Promise<T> {
    return Promise.withResolvers<T>().promise;
}

/** Has the pipeline's first read of a whole inbox object hang, and every later read go through. */
function stallingTheFirstWholeRead(): void {
    const get = env.UPLOADS.get.bind(env.UPLOADS);
    let stalled = false;
    vi.spyOn(env.UPLOADS, 'get').mockImplementation(async (key: string, options?: R2GetOptions) => {
        if (options === undefined && !stalled) {
            stalled = true;
            return never();
        }
        return get(key, options);
    });
}

/** Has the first transformation, the thumbnail's, hang, and every later one go through to the local binding. */
function stallingTheFirstTransformation(): void {
    const stuck = {
        transform: (): ImageTransformer => stuck,
        output: never,
    } as unknown as ImageTransformer;
    const input = env.IMAGES.input.bind(env.IMAGES);
    vi.spyOn(env.IMAGES, 'input').mockReturnValueOnce(stuck).mockImplementation(input);
}

/**
 * Has each call's limit run out after a second rather than a minute, by shortening every timer of exactly that length;
 * the pipeline runs in this isolate, so it sees the spy. A second is still far more than any local call takes.
 */
function shorteningCallLimits(): void {
    const wait = setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void, ms?: number) =>
        wait(callback, ms === CALL_LIMIT_MS ? 1000 : ms),
    );
}

/** Whether a log line is the pipeline's word that one attempt at `versionId` threw. */
function isFailedAttempt(logged: unknown, versionId: string): boolean {
    return (
        typeof logged === 'object' &&
        logged !== null &&
        'event' in logged &&
        logged.event === 'upload_stages' &&
        'versionId' in logged &&
        logged.versionId === versionId &&
        'outcome' in logged &&
        logged.outcome === 'threw'
    );
}

async function uploadRow(versionId: string): Promise<typeof schema.upload.$inferSelect | undefined> {
    return orm(env.DB).select().from(schema.upload).where(eq(schema.upload.versionId, versionId)).get();
}

/**
 * Has the pipeline's next write batch commit, then `between` run, then the step fail, so the step is retried after its
 * write committed, as when the engine loses a step's result.
 */
function failingAfterTheWrite(between?: () => Promise<unknown>): void {
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
        await batch(statements);
        await between?.();
        throw new Error('the step result was lost');
    });
}

/** Runs `between` just before the pipeline's next write batch, as an admin acting while a video transcodes would. */
function interruptingTheWrite(between: () => Promise<unknown>): void {
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
        await between();
        return batch(statements);
    });
}

async function mediaNames(): Promise<{ itemName: string }[]> {
    return orm(env.DB)
        .select({ itemName: schema.item.itemName })
        .from(schema.item)
        .where(eq(schema.item.itemType, 'media'))
        .all();
}

describe('upload pipeline', () => {
    beforeEach(async () => putDay(DAY));

    it('moves an inbox upload to its version key, labelled with its path, and records its IPTC caption and keywords', async () => {
        const versionId = await stage(`${DAY}full_metadata`, jpg);
        const acks = await deliver(versionId);
        const [inbox, item, originals, original, row] = await Promise.all([
            env.UPLOADS.head(inboxKey(versionId)),
            storedItem(DAY, 'full_metadata'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            env.ORIGINALS.head(originalKey(versionId)),
            uploadRow(versionId),
        ]);

        expect(acks).toStrictEqual(['1']);
        expect(inbox).toBeNull();
        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'image',
            published: false,
            title: 'My Image Title',
            description: 'My image description',
            tags: JPG_TAGS,
            width: 300,
            height: 225,
            versionId,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(versionId)]);
        expect(original?.httpMetadata?.contentType).toBe('image/jpeg');
        expect(original?.customMetadata).toStrictEqual({ path: `${DAY}full_metadata` });
        expect(row?.completedAt).not.toBeNull();
    });

    it('takes what kind of file it is from its bytes, whatever its name and the type the browser sent', async () => {
        standInTranscoder(async () => {
            throw new Error('a photo has no business here');
        });
        const versionId = await upload(`${DAY}clip`, jpg, { contentType: 'application/octet-stream' });
        const [item, original] = await Promise.all([
            storedItem(DAY, 'clip'),
            env.ORIGINALS.head(originalKey(versionId)),
        ]);

        expect(item).toMatchObject({ mediaType: 'image', width: 300, height: 225, versionId });
        expect(original?.httpMetadata?.contentType).toBe('image/jpeg');
    });

    it('makes both thumbnails and the detail image before anyone asks, so the first reader is served what is stored', async () => {
        const versionId = await upload(`${DAY}full_metadata`, jpg);
        const stored = await env.DERIVED.list({ prefix: `${derivedPrefix(versionId)}/` });
        const thumbnail = await call(
            imageUrl({ path: `${DAY}full_metadata`, versionId, size: { width: 200, height: 200 }, crop: null }),
        );
        const thumbnail2x = await call(
            imageUrl({ path: `${DAY}full_metadata`, versionId, size: { width: 400, height: 400 }, crop: null }),
        );
        const detail = await call(
            imageUrl({ path: `${DAY}full_metadata`, versionId, size: { width: 300, height: null }, crop: null }),
        );
        await Promise.all([thumbnail.body?.cancel(), thumbnail2x.body?.cancel(), detail.body?.cancel()]);

        // The JPEG is 300 by 225, so its detail image is its own width.
        expect(stored.objects.map((object) => object.key).toSorted()).toStrictEqual([
            `${derivedPrefix(versionId)}/200x200-webp`,
            `${derivedPrefix(versionId)}/300`,
            `${derivedPrefix(versionId)}/400x400-webp`,
        ]);
        expect(thumbnail.headers.get('x-derived')).toBe('stored');
        expect(thumbnail2x.headers.get('x-derived')).toBe('stored');
        expect(detail.headers.get('x-derived')).toBe('stored');
    });

    it('makes the detail image of a GIF a WebP, from what its bytes are rather than the type the browser sent', async () => {
        const versionId = await upload(`${DAY}animated`, gif, { contentType: 'image/jpeg' });
        const detail = await env.DERIVED.head(`${derivedPrefix(versionId)}/32`);

        expect(detail?.httpMetadata?.contentType).toBe('image/webp');
    });

    it('makes the three images at once, from the file it has already read', async () => {
        const versionId = await stage(`${DAY}full_metadata`, jpg);
        const originalReads = vi.spyOn(env.ORIGINALS, 'get');
        // Each derivative's write waits until all three are being written, which only images made at once can reach.
        const waiting: (() => void)[] = [];
        const put = env.DERIVED.put.bind(env.DERIVED);
        vi.spyOn(env.DERIVED, 'put').mockImplementation(async (key, value, options) => {
            await new Promise<void>((resolve) => {
                waiting.push(resolve);
                if (waiting.length === 3) {
                    for (const release of waiting) release();
                }
            });
            return put(key, value, options);
        });
        await deliver(versionId);
        const stored = await env.DERIVED.list({ prefix: `${derivedPrefix(versionId)}/` });

        expect(stored.objects).toHaveLength(3);
        expect(originalReads).not.toHaveBeenCalled();
    });

    it('logs how long the upload event took to arrive', async () => {
        const logged = vi.spyOn(console, 'info');
        const versionId = await upload(`${DAY}full_metadata`, jpg);

        expect(logged).toHaveBeenCalledWith({
            event: 'upload_event_delivered',
            versionId,
            delayMs: expect.any(Number) as number,
        });
    });

    it.each([
        { name: 'not an image', error: 'IMAGES_TRANSFORM_ERROR 9412: Unsupported image type' },
        { name: 'too many pixels', error: 'IMAGES_TRANSFORM_ERROR 9413: Image exceeds the maximum image area' },
        { name: 'in no format it takes', error: 'IMAGES_TRANSFORM_ERROR 9520: Unsupported image format' },
    ])('records a HEIC the Images binding says is $name as an upload error, not an item', async ({ error }) => {
        vi.spyOn(env.IMAGES, 'input').mockImplementation(() => {
            throw new Error(error);
        });
        const versionId = await upload(`${DAY}tenbit`, heic, { contentType: 'image/heic' });
        const [item, inbox, errors, row] = await Promise.all([
            storedItem(DAY, 'tenbit'),
            env.UPLOADS.head(inboxKey(versionId)),
            uploadErrors([`${DAY}tenbit`]),
            uploadRow(versionId),
        ]);

        expect(item).toBeUndefined();
        expect(inbox).toBeNull();
        expect(errors[`${DAY}tenbit`]).toBe(`the image cannot be decoded: ${error}`);
        expect(row?.completedAt).toBeNull();
    });

    it.each([
        { name: 'an internal error', error: 'IMAGES_TRANSFORM_ERROR 9527: Could not resize the image: internal error' },
        { name: 'a busy colo', error: 'IMAGES_TRANSFORM_ERROR 9522: The service in this colo is too busy' },
        { name: 'a lost connection', error: 'IMAGES_TRANSFORM_ERROR 9502: Images binding connection error' },
        { name: 'the internal error a sips HEIC gets', error: 'IMAGES_TRANSFORM_ERROR 9516: Internal error' },
    ])(
        'retries the step when the Images binding fails with $name, which is no fault of the file',
        async ({ error }) => {
            const input = env.IMAGES.input.bind(env.IMAGES);
            vi.spyOn(env.IMAGES, 'input')
                .mockImplementationOnce(() => {
                    throw new Error(error);
                })
                .mockImplementation(input);
            const versionId = await stage(`${DAY}busy`, jpg);
            await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
            const [item, errors] = await Promise.all([storedItem(DAY, 'busy'), uploadErrors([`${DAY}busy`])]);

            expect(item?.versionId).toBe(versionId);
            expect(errors).toStrictEqual({});
        },
    );

    it.each([
        { stage: 'read', hang: stallingTheFirstWholeRead },
        { stage: 'thumbnail', hang: stallingTheFirstTransformation },
    ])(
        'gives up on a $stage that never answers, says so, and finishes on the retry',
        async ({ stage: stalled, hang }) => {
            const warned = vi.spyOn(console, 'warn');
            hang();
            shorteningCallLimits();
            const versionId = await stage(`${DAY}stuck`, jpg);
            await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
            const [item, errors] = await Promise.all([storedItem(DAY, 'stuck'), uploadErrors([`${DAY}stuck`])]);

            expect(warned).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'upload_stages',
                    versionId,
                    attempt: 1,
                    outcome: 'threw',
                    error: `Error: ${stalled} did not finish within 60 s`,
                }),
            );
            expect(item?.versionId).toBe(versionId);
            expect(errors).toStrictEqual({});
        },
    );

    it('logs how long each stage of the photo took', async () => {
        const logged = vi.spyOn(console, 'info');
        const versionId = await upload(`${DAY}full_metadata`, jpg);

        expect(logged).toHaveBeenCalledWith({
            event: 'upload_stages',
            path: `${DAY}full_metadata`,
            versionId,
            attempt: 1,
            outcome: 'ready',
            ...Object.fromEntries(
                ['sniff', 'read', 'exif', 'original', 'thumbnail', 'thumbnail2x', 'detail'].map((name) => [
                    name,
                    expect.any(Number) as number,
                ]),
            ),
        });
    });

    it('tries the photo six times while the Images binding keeps failing, then tells the admin why', async () => {
        const warned = vi.spyOn(console, 'warn');
        vi.spyOn(env.IMAGES, 'input').mockImplementation(() => {
            throw new Error('IMAGES_TRANSFORM_ERROR 9529: The image timed out while processing');
        });
        const versionId = await stage(`${DAY}busy`, jpg);
        await deliver(versionId, { until: 'errored', modify: async (modifier) => modifier.disableRetryDelays() });
        const attempts = warned.mock.calls.filter(([logged]) => isFailedAttempt(logged, versionId));

        expect(attempts).toHaveLength(6);
        await expect(uploadErrors([`${DAY}busy`])).resolves.toStrictEqual({
            [`${DAY}busy`]: 'IMAGES_TRANSFORM_ERROR 9529: The image timed out while processing',
        });
        await expect(env.UPLOADS.head(inboxKey(versionId))).resolves.not.toBeNull();
    });

    it('records the XMP caption and tags of a HEIC, which has no IPTC', async () => {
        decodingAnyImage();
        await upload(`${DAY}photo`, heic, { contentType: 'image/heic' });

        await expect(storedItem(DAY, 'photo')).resolves.toMatchObject({
            title: 'Test Image Title',
            description: 'Test description',
            tags: ['test1', 'test2', 'test3'],
            width: 4032,
            height: 3024,
        });
    });

    it('lands under the album as it is named when the upload finishes, not when the URL was issued', async () => {
        const versionId = await stage(`${DAY}late`, jpg);
        await write('POST', '/api/album-rename/2024/06-15/', { newName: '06-16' });
        await deliver(versionId);
        const [moved, stale] = await Promise.all([storedItem('/2024/06-16/', 'late'), storedItem(DAY, 'late')]);

        expect(moved?.versionId).toBe(versionId);
        expect(stale).toBeUndefined();
    });

    it('becomes an upload error when its album was deleted in the meantime, and waits in the inbox for the purge', async () => {
        const versionId = await stage(`${DAY}orphan`, jpg);
        await callAsAdmin(`/api/album${DAY}`, { method: 'DELETE' });
        await deliver(versionId);
        const [errors, inbox, row] = await Promise.all([
            uploadErrors([`${DAY}orphan`]),
            env.UPLOADS.head(inboxKey(versionId)),
            uploadRow(versionId),
        ]);

        expect(errors[`${DAY}orphan`]).toBe(`Album [${DAY}] was deleted before the upload finished`);
        expect(inbox).not.toBeNull();
        expect(row).toMatchObject({ albumId: null, completedAt: null });
    });

    it('becomes an upload error when another item took its name in the meantime', async () => {
        const versionId = await stage(`${DAY}taken`, jpg);
        await putItem({ parentPath: DAY, itemName: 'taken', ...IMAGE, versionId: testVersionId('other') });
        await deliver(versionId);
        const [errors, item] = await Promise.all([uploadErrors([`${DAY}taken`]), storedItem(DAY, 'taken')]);

        expect(errors[`${DAY}taken`]).toBe(`A media item already exists at [${DAY}taken]`);
        expect(item?.versionId).toBe(testVersionId('other'));
    });

    it('leaves alone an inbox object nobody asked for', async () => {
        await env.UPLOADS.put(inboxKey('stray'), jpg);
        const acks = await deliver('stray');
        const [inbox, items] = await Promise.all([
            env.UPLOADS.head(inboxKey('stray')),
            orm(env.DB).select().from(schema.item).where(eq(schema.item.itemType, 'media')).all(),
        ]);

        expect(acks).toStrictEqual(['1']);
        expect(inbox).not.toBeNull();
        expect(items).toStrictEqual([]);
    });

    it('becomes the thumbnail of a day that has none, and leaves one that has', async () => {
        await upload(`${DAY}first`, jpg);
        await upload(`${DAY}second`, jpg);
        const [day, first] = await Promise.all([storedItem('/2024/', '06-15'), storedItem(DAY, 'first')]);

        expect(first?.id).toBeDefined();
        expect(day?.thumbnailId).toBe(first?.id);
    });

    it('finishes after a step that failed once, as in an R2 outage, since the step is retried', async () => {
        const versionId = await stage(`${DAY}retried`, jpg);
        await deliver(versionId, {
            modify: async (modifier) => {
                await modifier.disableRetryDelays();
                await modifier.mockStepError(
                    { name: 'read the file, and store a photo and make its derivatives' },
                    new Error('R2 unavailable'),
                    1,
                );
            },
        });
        const [item, inbox] = await Promise.all([storedItem(DAY, 'retried'), env.UPLOADS.head(inboxKey(versionId))]);

        expect(item?.versionId).toBe(versionId);
        expect(inbox).toBeNull();
    });

    it.each([
        { name: 'nothing changed', between: undefined, items: [{ itemName: 'retried' }] },
        {
            name: 'the admin renamed the item',
            between: async () => write('POST', `/api/media-rename${DAY}retried`, { newName: 'renamed' }),
            items: [{ itemName: 'renamed' }],
        },
        {
            name: 'the admin deleted the item',
            between: async () => callAsAdmin(`/api/media${DAY}retried`, { method: 'DELETE' }),
            items: [],
        },
    ])('succeeds once when the write is retried after it committed and $name', async ({ between, items }) => {
        const versionId = await stage(`${DAY}retried`, jpg);
        failingAfterTheWrite(between);
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const [media, errors, row, inbox] = await Promise.all([
            mediaNames(),
            uploadErrors([`${DAY}retried`]),
            uploadRow(versionId),
            env.UPLOADS.head(inboxKey(versionId)),
        ]);

        expect(media).toStrictEqual(items);
        expect(errors).toStrictEqual({});
        expect(row?.completedAt).not.toBeNull();
        expect(inbox).toBeNull();
    });

    it('succeeds when the write is retried after it committed and its finished upload row was cleaned up', async () => {
        const versionId = await stage(`${DAY}retried`, jpg);
        failingAfterTheWrite(async () =>
            orm(env.DB).delete(schema.upload).where(eq(schema.upload.versionId, versionId)).run(),
        );
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const [media, errors] = await Promise.all([mediaNames(), uploadErrors([`${DAY}retried`])]);

        expect(media).toStrictEqual([{ itemName: 'retried' }]);
        expect(errors).toStrictEqual({});
    });

    it('becomes an upload error when its album was deleted and made again in flight, though the new one has its id', async () => {
        const versionId = await stage(`${DAY}orphan`, jpg);
        const before = await storedItem('/2024/', '06-15');
        interruptingTheWrite(async () => {
            await callAsAdmin(`/api/album${DAY}`, { method: 'DELETE' });
            await putItem({ parentPath: '/2024/', itemName: '06-15', itemType: 'album' });
        });
        await deliver(versionId);
        const [after, media, errors] = await Promise.all([
            storedItem('/2024/', '06-15'),
            mediaNames(),
            uploadErrors([`${DAY}orphan`]),
        ]);

        expect(after?.id).toBe(before?.id);
        expect(media).toStrictEqual([]);
        expect(errors[`${DAY}orphan`]).toBe(`Album [${DAY}] was deleted before the upload finished`);
    });
});

describe('replacing a media item', () => {
    const CROP = { x: 10, y: 10, width: 50, height: 50 };

    beforeEach(async () => {
        await putDay(DAY);
        await putItem({
            parentPath: DAY,
            itemName: 'felix',
            ...IMAGE,
            versionId: testVersionId('old'),
            title: 'Felix',
            thumbnailCrop: CROP,
        });
        await write('PATCH', `/api/album-thumb${DAY}`, { mediaPath: `${DAY}felix` });
    });

    it('points the row at the new file, keeping its caption, its crop when the size is unchanged, and its place as the thumbnail', async () => {
        const versionId = await upload(`${DAY}felix`, jpg, { replace: true });
        const [felix, day] = await Promise.all([storedItem(DAY, 'felix'), storedItem('/2024/', '06-15')]);

        expect(felix).toMatchObject({
            versionId,
            title: 'Felix',
            // The row had no description, so the file's fills it in.
            description: 'My image description',
            tags: JPG_TAGS,
            thumbnailCrop: CROP,
        });
        expect(day?.thumbnailId).toBe(felix?.id);
    });

    it("joins the file's tags to the row's, each once, so a tag given by hand survives the file", async () => {
        await putItem({
            parentPath: DAY,
            itemName: 'tagged',
            ...IMAGE,
            versionId: testVersionId('tagged'),
            tags: ['felix', 'dog'],
        });

        await upload(`${DAY}tagged`, jpg, { replace: true });
        const tagged = await storedItem(DAY, 'tagged');

        expect(tagged?.tags?.toSorted()).toStrictEqual(['felix', ...JPG_TAGS].toSorted());
    });

    it("keeps the row's tags when the file brings none", async () => {
        await putItem({
            parentPath: DAY,
            itemName: 'tagged',
            ...IMAGE,
            versionId: testVersionId('tagged'),
            tags: ['felix'],
        });

        await upload(`${DAY}tagged`, noTags, { replace: true });

        await expect(storedItem(DAY, 'tagged')).resolves.toMatchObject({ tags: ['felix'] });
    });

    it('takes a file in another format under the same name, dropping a crop cut from another size', async () => {
        const versionId = await upload(`${DAY}felix`, png, { replace: true, contentType: 'image/png' });
        const [felix, original, album] = await Promise.all([
            storedItem(DAY, 'felix'),
            env.ORIGINALS.head(originalKey(versionId)),
            albumAsAdmin(DAY),
        ]);

        expect(felix).toMatchObject({
            versionId,
            mediaType: 'image',
            width: 220,
            height: 212,
            thumbnailCrop: null,
            title: 'Felix',
        });
        expect(original?.httpMetadata?.contentType).toBe('image/png');
        expect(album.thumbnail?.path).toBe(`${DAY}felix`);
    });

    it('keeps a name the item was given while the upload was in flight', async () => {
        const versionId = await stage(`${DAY}felix`, png, { replace: true, contentType: 'image/png' });
        await write('POST', `/api/media-rename${DAY}felix`, { newName: 'cat' });
        await deliver(versionId);
        const [cat, felix] = await Promise.all([storedItem(DAY, 'cat'), storedItem(DAY, 'felix')]);

        expect(cat?.versionId).toBe(versionId);
        expect(felix).toBeUndefined();
    });

    it('becomes an upload error when the item was deleted in the meantime', async () => {
        const versionId = await stage(`${DAY}felix`, jpg, { replace: true });
        await callAsAdmin(`/api/media${DAY}felix`, { method: 'DELETE' });
        await deliver(versionId);
        const [errors, item, row] = await Promise.all([
            uploadErrors([`${DAY}felix`]),
            storedItem(DAY, 'felix'),
            uploadRow(versionId),
        ]);

        expect(errors[`${DAY}felix`]).toBe(`Media [${DAY}felix] was deleted before the upload finished`);
        expect(item).toBeUndefined();
        expect(row).toMatchObject({ targetId: null, replacement: true, completedAt: null });
    });

    it('leaves a later replacement in place when the write is retried after it committed', async () => {
        const versionId = await stage(`${DAY}felix`, jpg, { replace: true });
        // What a later replacement's write leaves on the row.
        failingAfterTheWrite(async () =>
            orm(env.DB)
                .update(schema.item)
                .set({ versionId: testVersionId('later') })
                .where(eq(schema.item.itemName, 'felix'))
                .run(),
        );
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const [felix, errors] = await Promise.all([storedItem(DAY, 'felix'), uploadErrors([`${DAY}felix`])]);

        expect(felix?.versionId).toBe(testVersionId('later'));
        expect(errors).toStrictEqual({});
    });

    it('succeeds when the write is retried after it committed and the admin deleted the item', async () => {
        const versionId = await stage(`${DAY}felix`, jpg, { replace: true });
        failingAfterTheWrite(async () => callAsAdmin(`/api/media${DAY}felix`, { method: 'DELETE' }));
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const [media, errors, row] = await Promise.all([
            mediaNames(),
            uploadErrors([`${DAY}felix`]),
            uploadRow(versionId),
        ]);

        expect(media).toStrictEqual([]);
        expect(errors).toStrictEqual({});
        expect(row?.completedAt).not.toBeNull();
    });

    it('becomes an upload error when the item was deleted in flight, and leaves the new item that took its id', async () => {
        const versionId = await stage(`${DAY}felix`, jpg, { replace: true });
        const before = await storedItem(DAY, 'felix');
        interruptingTheWrite(async () => {
            await callAsAdmin(`/api/media${DAY}felix`, { method: 'DELETE' });
            await putItem({ parentPath: DAY, itemName: 'milo', ...IMAGE, versionId: testVersionId('milo') });
        });
        await deliver(versionId);
        const [milo, errors] = await Promise.all([storedItem(DAY, 'milo'), uploadErrors([`${DAY}felix`])]);

        expect(milo).toMatchObject({ id: before?.id, versionId: testVersionId('milo') });
        expect(errors[`${DAY}felix`]).toBe(`Media [${DAY}felix] was deleted before the upload finished`);
    });

    it('turns a photo into a video, with the transcoder', async () => {
        const versionId = await stage(`${DAY}felix`, mov, { replace: true });
        standInTranscoder(transcoding);
        await deliver(versionId);
        const clip = await storedItem(DAY, 'felix');

        expect(clip).toMatchObject({
            versionId,
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
            title: 'Felix',
            thumbnailCrop: null,
        });
    });
});

describe('image uploads', () => {
    beforeEach(async () => putDay(DAY));

    it('records a file in no format the gallery takes instead of an item, and drops it', async () => {
        const versionId = await upload(`${DAY}notes`, new TextEncoder().encode('just some notes'));
        const [item, inbox, errors] = await Promise.all([
            storedItem(DAY, 'notes'),
            env.UPLOADS.head(inboxKey(versionId)),
            uploadErrors([`${DAY}notes`]),
        ]);

        expect(item).toBeUndefined();
        expect(inbox).toBeNull();
        expect(errors[`${DAY}notes`]).toBe('not a photo or video in a format the gallery takes');
    });

    it('records a JPEG whose header says no size instead of an item, and drops it', async () => {
        const versionId = await upload(`${DAY}broken`, Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0]));
        const [item, originals, inbox, errors] = await Promise.all([
            storedItem(DAY, 'broken'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            env.UPLOADS.head(inboxKey(versionId)),
            uploadErrors([`${DAY}broken`]),
        ]);

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(errors[`${DAY}broken`]).toBe('the image does not say its size');
    });
});

describe('a batch of uploads', () => {
    beforeEach(async () => putDay(DAY));

    it('starts a pipeline instance per event and acks each, so the uploads run side by side', async () => {
        const versionIds = await Promise.all(
            ['first', 'second', 'third'].map(async (name) => stage(`${DAY}${name}`, jpg)),
        );
        const instances = await Promise.all(
            versionIds.map(async (versionId) => introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId)),
        );
        try {
            const batch = uploadBatch(versionIds);
            const ctx = createExecutionContext();
            await handler.queue?.(batch, env, ctx);
            await waitOnExecutionContext(ctx);
            await Promise.all(instances.map(async (instance) => instance.waitForStatus('complete')));
            const result = await getQueueResult(batch, ctx);
            const originals = await env.ORIGINALS.list({ prefix: 'originals/' });

            expect(result.explicitAcks).toStrictEqual(['1', '2', '3']);
            expect(originals.objects.map((object) => object.key).toSorted()).toStrictEqual(
                versionIds.map(originalKey).toSorted(),
            );
        } finally {
            await Promise.all(instances.map(async (instance) => instance.dispose()));
        }
    });

    it('leaves an event unacked when its pipeline cannot start, so the queue delivers it again', async () => {
        vi.spyOn(env.UPLOAD_PIPELINE, 'createBatch').mockRejectedValueOnce(new Error('Workflows unavailable'));
        const batch = uploadBatch([testVersionId('v1')]);
        const ctx = createExecutionContext();
        const consumed = handler.queue?.(batch, env, ctx);

        await expect(consumed).rejects.toThrow('Workflows unavailable');
        await expect(getQueueResult(batch, ctx)).resolves.toHaveProperty('explicitAcks', []);
    });
});

describe('video uploads', () => {
    beforeEach(async () => putDay(DAY));

    it('records a file ffmpeg rejects instead of an item, and drops it', async () => {
        standInTranscoder(rejecting);
        const versionId = await upload(`${DAY}broken`, mov);
        const [item, originals, inbox, errors] = await Promise.all([
            storedItem(DAY, 'broken'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            env.UPLOADS.head(inboxKey(versionId)),
            uploadErrors([`${DAY}broken`, `${DAY}fine`]),
        ]);

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(Object.keys(errors)).toStrictEqual([`${DAY}broken`]);
        expect(errors[`${DAY}broken`]).toBe('ffmpeg exited 1: moov atom not found');
    });

    it('clears the error once a later upload of the same path succeeds', async () => {
        standInTranscoder(rejecting);
        await upload(`${DAY}again`, mov);
        standInTranscoder(transcoding);
        await upload(`${DAY}again`, mov);
        const { uploadError } = schema;
        const remaining = await orm(env.DB)
            .select()
            .from(uploadError)
            .where(eq(uploadError.path, `${DAY}again`))
            .all();

        expect(remaining).toStrictEqual([]);
    });
});

describe('video upload retries', () => {
    beforeEach(async () => putDay(DAY));

    it('leaves the upload in the inbox when the transcoder cannot be reached, once the retries are spent', async () => {
        standInTranscoder(async () => {
            throw new Error('container unreachable');
        });
        const versionId = await stage(`${DAY}later`, mov);
        const acks = await deliver(versionId, {
            until: 'errored',
            modify: async (modifier) => modifier.disableRetryDelays(),
        });

        expect(acks).toStrictEqual(['1']);
        await expect(env.UPLOADS.head(inboxKey(versionId))).resolves.not.toBeNull();
        await expect(env.ORIGINALS.list({ prefix: 'originals/' })).resolves.toMatchObject({ objects: [] });
    });

    it('tries the container four times, then tells the admin why', async () => {
        let attempts = 0;
        standInTranscoder(async () => {
            attempts++;
            throw new Error('container unreachable');
        });
        const versionId = await stage(`${DAY}later`, mov);
        await deliver(versionId, { until: 'errored', modify: async (modifier) => modifier.disableRetryDelays() });

        expect(attempts).toBe(4);
        await expect(uploadErrors([`${DAY}later`])).resolves.toStrictEqual({
            [`${DAY}later`]: 'container unreachable',
        });
    });

    it('records no upload error when only dropping the inbox object fails, since the item was written', async () => {
        standInTranscoder(transcoding);
        const versionId = await stage(`${DAY}clip`, mov);
        const drop = env.UPLOADS.delete.bind(env.UPLOADS);
        vi.spyOn(env.UPLOADS, 'delete').mockImplementation(async (keys) => {
            if (keys === inboxKey(versionId)) {
                throw new Error('R2 unavailable');
            }
            return drop(keys);
        });
        await deliver(versionId, { until: 'errored', modify: async (modifier) => modifier.disableRetryDelays() });

        await expect(storedItem(DAY, 'clip')).resolves.toMatchObject({ mediaType: 'video' });
        await expect(uploadErrors([`${DAY}clip`])).resolves.toStrictEqual({});
    });

    it('writes nothing twice when the event is delivered again after success, as Queues may do', async () => {
        standInTranscoder(transcoding);
        const versionId = await stage(`${DAY}clip`, mov);
        await deliver(versionId);
        await deliver(versionId);
        const [item, originals, inbox] = await Promise.all([
            storedItem(DAY, 'clip'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            env.UPLOADS.head(inboxKey(versionId)),
        ]);

        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(versionId)]);
        expect(inbox).toBeNull();
    });

    it('has the container write the MP4 and poster for the version into the derived bucket', async () => {
        const versionId = await stage(`${DAY}clip`, mov);
        const jobs: Record<string, string>[] = [];
        standInTranscoder(async (init) => {
            jobs.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, string>);
            return transcoding();
        });
        await deliver(versionId);
        const paths = Object.fromEntries(
            Object.entries(jobs[0] ?? {}).map(([name, url]) => [name, new URL(url).pathname]),
        );

        expect(paths).toStrictEqual({
            src: `/${env.UPLOADS_BUCKET}/${inboxKey(versionId)}`,
            mp4Put: `/${env.DERIVED_BUCKET}/${videoKey(versionId)}`,
            posterPut: `/${env.DERIVED_BUCKET}/${posterKey(versionId)}`,
        });
    });
});
