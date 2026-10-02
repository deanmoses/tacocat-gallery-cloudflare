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
import { WARM_LIMIT_MS } from '../../src/gallery/derivatives';
import { UNSTARTED_ERROR } from '../../src/gallery/pipeline';
import { derivedPrefix, originalKey, posterKey, videoKey } from '../../src/storage/keys';
import { READ_STALL_MS } from '../../src/storage/read';
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

// A QuickTime movie's first box, which is all the stand-in transcoder needs.
const mov = Uint8Array.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0]);

const DAY = '/2024/06-15/';
const IMAGE = { itemType: 'media', mediaType: 'image', width: 300, height: 225 } as const;

interface Staged {
    replace?: boolean;
    /** The extension of the file's name, which decides the type it is stored as. */
    extension?: string;
}

/**
 * Asks for an upload URL as the app does and puts the file where the browser's PUT would, as the type the URL was
 * signed with, returning the version id the upload was minted, ready for its event to be delivered.
 */
async function stage(path: string, file: Uint8Array, { replace, extension = 'jpg' }: Staged = {}): Promise<string> {
    const response = await write('POST', `/api/presigned${DAY}`, [
        { path, extension, ...(replace === undefined ? {} : { replace }) },
    ]);
    if (!response.ok) {
        throw new Error(`presign refused: ${await response.text()}`);
    }
    const presigned = parsePresigned(await response.json())[path];
    if (presigned === undefined) {
        throw new Error(`nothing presigned for ${path}`);
    }
    await env.ORIGINALS.put(originalKey(presigned.versionId), file, {
        httpMetadata: { contentType: presigned.contentType },
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

/** A promise nothing ever settles, as a call that hangs returns. */
async function never<T>(): Promise<T> {
    return Promise.withResolvers<T>().promise;
}

const STALLED_AFTER = 1024;

/**
 * Has the first `times` reads of an original stall, of its start or of the whole object, and every later one go
 * through: before the object's body starts, or partway through it, once its first kilobyte has arrived.
 */
function stallingReads(times: number, where: 'before its body' | 'partway through', of = 'its start'): void {
    const get = env.ORIGINALS.get.bind(env.ORIGINALS);
    let stalled = 0;
    vi.spyOn(env.ORIGINALS, 'get').mockImplementation(async (key: string, options?: R2GetOptions) => {
        const whole = options?.range === undefined;
        if (stalled === times || whole !== (of === 'the whole file')) {
            return get(key, options);
        }
        stalled += 1;
        if (where === 'before its body') {
            return never();
        }
        const object = await get(key, options);
        if (object === null) {
            return null;
        }
        const start = new Uint8Array(await object.arrayBuffer()).subarray(0, STALLED_AFTER);
        const body = new ReadableStream<Uint8Array>({
            start: (controller) => {
                controller.enqueue(start);
            },
        });
        return { size: object.size, body } as R2ObjectBody;
    });
}

/**
 * Has a read's wait for its next byte run out after a fifth of a second, by shortening every timer of exactly that
 * length; the pipeline runs in this isolate, so it sees the spy. It is still far more than any local read takes.
 */
function shorteningReadStalls(): void {
    const wait = setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void, ms?: number) =>
        wait(callback, ms === READ_STALL_MS ? 200 : ms),
    );
}

/** `jpeg` with `count` comment segments of 64 KB ahead of its own, pushing its metadata that much further in. */
function paddedJpeg(jpeg: Uint8Array, count: number): Uint8Array {
    const comment = new Uint8Array(2 + 0xff_ff).fill(0x20);
    comment.set([0xff, 0xfe, 0xff, 0xff]);
    const padded = new Uint8Array(jpeg.length + count * comment.length);
    padded.set(jpeg.subarray(0, 2));
    for (let index = 0; index < count; index += 1) {
        padded.set(comment, 2 + index * comment.length);
    }
    padded.set(jpeg.subarray(2), 2 + count * comment.length);
    return padded;
}

/** The stages the first attempt at reading the photo logged, by name. */
function photoStages(logged: unknown[][], versionId: string): string[] {
    const line = logged
        .map(([entry]) => entry as Record<string, unknown>)
        .find((entry) => entry['event'] === 'upload_stages' && entry['versionId'] === versionId && 'head' in entry);
    return Object.keys(line ?? {});
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

    it('makes an item of an original put under its version key, with its IPTC caption and keywords, and leaves the original as it is', async () => {
        const versionId = await stage(`${DAY}full_metadata`, jpg);
        const writes = vi.spyOn(env.ORIGINALS, 'put');
        const acks = await deliver(versionId);
        const [item, originals, original, row] = await Promise.all([
            storedItem(DAY, 'full_metadata'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            env.ORIGINALS.head(originalKey(versionId)),
            uploadRow(versionId),
        ]);

        expect(acks).toStrictEqual(['1']);
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
        expect(writes).not.toHaveBeenCalled();
        expect(row?.completedAt).not.toBeNull();
    });

    it('takes what kind of file it is from the type it was stored as, whatever its bytes are', async () => {
        standInTranscoder(transcoding);
        const versionId = await upload(`${DAY}clip`, jpg, { extension: 'mov' });

        await expect(storedItem(DAY, 'clip')).resolves.toMatchObject({
            mediaType: 'video',
            width: 1080,
            height: 1920,
            versionId,
        });
    });

    it('makes the detail image before anyone asks, and leaves the thumbnails to their first reader', async () => {
        const versionId = await upload(`${DAY}full_metadata`, jpg);
        const stored = await env.DERIVED.list({ prefix: `${derivedPrefix(versionId)}/` });
        const detail = await call(
            imageUrl({ path: `${DAY}full_metadata`, versionId, size: { width: 300, height: null }, crop: null }),
        );
        const thumbnail = await call(
            imageUrl({ path: `${DAY}full_metadata`, versionId, size: { width: 200, height: 200 }, crop: null }),
        );
        await Promise.all([thumbnail.body?.cancel(), detail.body?.cancel()]);

        // The JPEG is 300 by 225, so its detail image is its own width.
        expect(stored.objects.map((object) => object.key)).toStrictEqual([`${derivedPrefix(versionId)}/300`]);
        expect(detail.headers.get('x-derived')).toBe('stored');
        expect(thumbnail.headers.get('x-derived')).toBe('generated');
    });

    it('makes the detail image of a GIF a WebP', async () => {
        const versionId = await upload(`${DAY}animated`, gif, { extension: 'gif' });
        const detail = await env.DERIVED.head(`${derivedPrefix(versionId)}/32`);

        expect(detail?.httpMetadata?.contentType).toBe('image/webp');
    });

    it("makes a video's detail image from the poster its transcoder wrote", async () => {
        standInTranscoder(async (init) => {
            const job = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { posterPut: string };
            await env.DERIVED.put(new URL(job.posterPut).pathname.replace(`/${env.DERIVED_BUCKET}/`, ''), jpg, {
                httpMetadata: { contentType: 'image/jpeg' },
            });
            return transcoding();
        });
        const versionId = await upload(`${DAY}clip`, mov, { extension: 'mov' });
        const stored = await env.DERIVED.list({ prefix: `${derivedPrefix(versionId)}/` });

        // The clip is 1080 by 1920, so its detail image is 1024 tall.
        expect(stored.objects.map((object) => object.key).toSorted()).toStrictEqual([
            posterKey(versionId),
            `${derivedPrefix(versionId)}/x1024`,
        ]);
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
        { name: 'the file cannot be decoded', error: 'IMAGES_TRANSFORM_ERROR 9412: Unsupported image type' },
        { name: 'the service is busy', error: 'IMAGES_TRANSFORM_ERROR 9522: The service in this colo is too busy' },
    ])(
        'writes the item though its detail image could not be made because $name, trying once and telling only the log',
        async ({ error }) => {
            const warned = vi.spyOn(console, 'warn');
            const tried = vi.spyOn(env.IMAGES, 'input').mockImplementation(() => {
                throw new Error(error);
            });
            const versionId = await upload(`${DAY}tenbit`, heic, { extension: 'heic' });
            const [item, errors, row] = await Promise.all([
                storedItem(DAY, 'tenbit'),
                uploadErrors([`${DAY}tenbit`]),
                uploadRow(versionId),
            ]);

            expect(item).toMatchObject({ versionId, width: 4032, height: 3024 });
            expect(errors).toStrictEqual({});
            expect(row?.completedAt).not.toBeNull();
            expect(tried).toHaveBeenCalledExactlyOnceWith(expect.anything());
            expect(warned).toHaveBeenCalledWith({
                event: 'detail_not_warmed',
                path: `${DAY}tenbit`,
                versionId,
                error: `Error: ${error}`,
            });
        },
    );

    it('writes the item and ends complete though making its detail image never answers', async () => {
        const warned = vi.spyOn(console, 'warn');
        const stuck = { transform: (): ImageTransformer => stuck, output: never } as unknown as ImageTransformer;
        vi.spyOn(env.IMAGES, 'input').mockReturnValue(stuck);
        const wait = setTimeout;
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void, ms?: number) =>
            wait(callback, ms === WARM_LIMIT_MS ? 200 : ms),
        );
        const versionId = await upload(`${DAY}stuck`, jpg);

        await expect(storedItem(DAY, 'stuck')).resolves.toMatchObject({ versionId });
        await expect(uploadErrors([`${DAY}stuck`])).resolves.toStrictEqual({});
        expect(warned).toHaveBeenCalledWith({
            event: 'detail_not_warmed',
            path: `${DAY}stuck`,
            versionId,
            error: 'Error: detail did not finish within 60 s',
        });
    });

    it.each([
        { where: 'before its body' as const, of: 'its start', bytes: 0 },
        { where: 'partway through' as const, of: 'its start', bytes: STALLED_AFTER },
        { where: 'before its body' as const, of: 'the whole file', bytes: 0 },
        { where: 'partway through' as const, of: 'the whole file', bytes: STALLED_AFTER },
    ])('reads again at once when a read of $of stalls $where, saying how far it got', async ({ where, of, bytes }) => {
        const warned = vi.spyOn(console, 'warn');
        stallingReads(1, where, of);
        shorteningReadStalls();
        // Read whole for its facts, since its metadata runs past its start.
        const versionId = await stage(`${DAY}stalled`, paddedJpeg(jpg, 5));
        await deliver(versionId);
        const item = await storedItem(DAY, 'stalled');

        expect(warned).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'read_stalled', key: originalKey(versionId), tried: 1, bytes }),
        );
        expect(warned.mock.calls.filter(([logged]) => isFailedAttempt(logged, versionId))).toStrictEqual([]);
        expect(item).toMatchObject({ title: 'My Image Title', tags: JPG_TAGS, versionId });
    });

    it('fails the attempt on a read that ends short, rather than taking part of the file, and finishes on the retry', async () => {
        const warned = vi.spyOn(console, 'warn');
        const get = env.ORIGINALS.get.bind(env.ORIGINALS);
        vi.spyOn(env.ORIGINALS, 'get').mockImplementationOnce(async (key: string, options?: R2GetOptions) => {
            const object = await get(key, options);
            if (object === null) {
                return null;
            }
            const start = new Uint8Array(await object.arrayBuffer()).subarray(0, STALLED_AFTER);
            return { size: object.size, body: new Blob([start]).stream() } as R2ObjectBody;
        });
        const versionId = await stage(`${DAY}short`, jpg);
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const item = await storedItem(DAY, 'short');

        expect(warned).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'upload_stages',
                versionId,
                attempt: 1,
                outcome: 'threw',
                error: `Error: reading ${originalKey(versionId)} ended after ${String(STALLED_AFTER)} of ${String(jpg.length)} bytes`,
            }),
        );
        expect(item).toMatchObject({ title: 'My Image Title', versionId });
    });

    it('gives up on a read that stalls three times, and finishes when the step is retried', async () => {
        const warned = vi.spyOn(console, 'warn');
        stallingReads(3, 'partway through');
        shorteningReadStalls();
        const versionId = await stage(`${DAY}stalled`, jpg);
        await deliver(versionId, { modify: async (modifier) => modifier.disableRetryDelays() });
        const item = await storedItem(DAY, 'stalled');

        expect(warned).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'upload_stages',
                versionId,
                attempt: 1,
                outcome: 'threw',
                error: `Error: reading ${originalKey(versionId)} stalled 3 times`,
            }),
        );
        expect(item?.versionId).toBe(versionId);
    });

    it('reads a JPEG whose metadata fits in its first 256 KB no further than that, and any other photo whole', async () => {
        const logged = vi.spyOn(console, 'info');
        const jpeg = await upload(`${DAY}full_metadata`, jpg);
        const other = await upload(`${DAY}png`, png, { extension: 'png' });

        expect(photoStages(logged.mock.calls, jpeg)).not.toContain('read');
        expect(photoStages(logged.mock.calls, other)).toContain('read');
    });

    it('reads a JPEG whole when its metadata runs past its first 256 KB, and still finds its caption', async () => {
        const logged = vi.spyOn(console, 'info');
        const versionId = await upload(`${DAY}padded`, paddedJpeg(jpg, 5));
        const item = await storedItem(DAY, 'padded');

        expect(photoStages(logged.mock.calls, versionId)).toContain('read');
        expect(item).toMatchObject({ title: 'My Image Title', tags: JPG_TAGS, width: 300, height: 225 });
    });

    it('logs how long each stage of reading the photo took', async () => {
        const logged = vi.spyOn(console, 'info');
        const versionId = await upload(`${DAY}full_metadata`, jpg);

        expect(logged).toHaveBeenCalledWith({
            event: 'upload_stages',
            path: `${DAY}full_metadata`,
            versionId,
            attempt: 1,
            outcome: 'ready',
            head: expect.any(Number) as number,
            start: expect.any(Number) as number,
            exif: expect.any(Number) as number,
        });
    });

    it('tries the photo six times while the bucket keeps failing, then tells the admin why', async () => {
        const warned = vi.spyOn(console, 'warn');
        vi.spyOn(env.ORIGINALS, 'head').mockRejectedValue(new Error('R2 unavailable'));
        const versionId = await stage(`${DAY}busy`, jpg);
        await deliver(versionId, { until: 'errored', modify: async (modifier) => modifier.disableRetryDelays() });
        const attempts = warned.mock.calls.filter(([logged]) => isFailedAttempt(logged, versionId));

        expect(attempts).toHaveLength(6);
        await expect(uploadErrors([`${DAY}busy`])).resolves.toStrictEqual({ [`${DAY}busy`]: 'R2 unavailable' });
    });

    it('records the XMP caption and tags of a HEIC, which has no IPTC', async () => {
        await upload(`${DAY}photo`, heic, { extension: 'heic' });

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

    it('becomes an upload error when its album was deleted in the meantime', async () => {
        const versionId = await stage(`${DAY}orphan`, jpg);
        await callAsAdmin(`/api/album${DAY}`, { method: 'DELETE' });
        await deliver(versionId);
        const [errors, row] = await Promise.all([uploadErrors([`${DAY}orphan`]), uploadRow(versionId)]);

        expect(errors[`${DAY}orphan`]).toBe(`Album [${DAY}] was deleted before the upload finished`);
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

    it('leaves alone an original nobody presigned, as a script that copies one in writes', async () => {
        await env.ORIGINALS.put(originalKey('stray'), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const acks = await deliver('stray');
        const [original, derived] = await Promise.all([env.ORIGINALS.head(originalKey('stray')), env.DERIVED.list()]);

        expect(acks).toStrictEqual(['1']);
        expect(original).not.toBeNull();
        expect(derived.objects).toStrictEqual([]);
        await expect(mediaNames()).resolves.toStrictEqual([]);
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
                await modifier.mockStepError({ name: 'read the file' }, new Error('R2 unavailable'), 1);
            },
        });

        await expect(storedItem(DAY, 'retried')).resolves.toMatchObject({ versionId });
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
        const [media, errors, row] = await Promise.all([
            mediaNames(),
            uploadErrors([`${DAY}retried`]),
            uploadRow(versionId),
        ]);

        expect(media).toStrictEqual(items);
        expect(errors).toStrictEqual({});
        expect(row?.completedAt).not.toBeNull();
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
        const versionId = await upload(`${DAY}felix`, png, { replace: true, extension: 'png' });
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
        const versionId = await stage(`${DAY}felix`, png, { replace: true, extension: 'png' });
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
        const versionId = await stage(`${DAY}felix`, mov, { replace: true, extension: 'mov' });
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

    it.each([
        {
            what: 'a file that is no image',
            file: new TextEncoder().encode('just some notes'),
            error: /^not a readable image/v,
        },
        {
            what: 'a JPEG whose header says no size',
            file: Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0]),
            error: /^the image does not say its size$/v,
        },
    ])(
        'records $what named as a photo as an upload error instead of an item, and keeps the file',
        async ({ file, error }) => {
            const versionId = await upload(`${DAY}broken`, file);
            const [item, original, errors] = await Promise.all([
                storedItem(DAY, 'broken'),
                env.ORIGINALS.head(originalKey(versionId)),
                uploadErrors([`${DAY}broken`]),
            ]);

            expect(item).toBeUndefined();
            expect(original).not.toBeNull();
            expect(errors[`${DAY}broken`]).toMatch(error);
        },
    );
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
        vi.spyOn(env.UPLOAD_PIPELINE, 'create').mockRejectedValueOnce(new Error('Workflows unavailable'));
        const batch = uploadBatch([testVersionId('v1')]);
        const ctx = createExecutionContext();
        const consumed = handler.queue?.(batch, env, ctx);

        await expect(consumed).rejects.toThrow('Workflows unavailable');
        await expect(getQueueResult(batch, ctx)).resolves.toHaveProperty('explicitAcks', []);
    });

    it('leaves an event unacked when Workflows says its instance exists but none does, and processes it on redelivery', async () => {
        // Production once had a batch create return no instance for an id that had none, and the upload was lost. The
        // consumer calls create now, but the batch create is stood in too, so the test reproduces that fault whichever
        // the consumer calls.
        vi.spyOn(env.UPLOAD_PIPELINE, 'createBatch').mockResolvedValueOnce([]);
        vi.spyOn(env.UPLOAD_PIPELINE, 'create').mockRejectedValueOnce(new Error('instance.already_exists'));
        const versionId = await stage(`${DAY}lost`, jpg);
        const batch = uploadBatch([versionId]);
        const ctx = createExecutionContext();
        const consumed = handler.queue?.(batch, env, ctx);

        await expect(consumed).rejects.toThrow('instance.already_exists');
        await expect(getQueueResult(batch, ctx)).resolves.toHaveProperty('explicitAcks', []);
        await expect(deliver(versionId)).resolves.toStrictEqual(['1']);
        await expect(storedItem(DAY, 'lost')).resolves.toMatchObject(IMAGE);
    });

    it('leaves an event unacked when Workflows says it started an instance that does not exist', async () => {
        const versionId = testVersionId('v1');
        vi.spyOn(env.UPLOAD_PIPELINE, 'create').mockResolvedValueOnce({ id: versionId } as WorkflowInstance);
        const batch = uploadBatch([versionId]);
        const ctx = createExecutionContext();
        const consumed = handler.queue?.(batch, env, ctx);

        await expect(consumed).rejects.toThrow('instance.not_found');
        await expect(getQueueResult(batch, ctx)).resolves.toHaveProperty('explicitAcks', []);
    });

    it('acks an event delivered again while its instance exists, and starts nothing', async () => {
        const versionId = await stage(`${DAY}twice`, jpg);
        // Held open, since disposing of it drops the instance.
        await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
        const consume = async (): Promise<string[]> => {
            const batch = uploadBatch([versionId]);
            const ctx = createExecutionContext();
            await handler.queue?.(batch, env, ctx);
            await waitOnExecutionContext(ctx);
            return (await getQueueResult(batch, ctx)).explicitAcks;
        };
        await consume();
        await instance.waitForStatus('complete');
        const logged = vi.spyOn(console, 'info');

        await expect(consume()).resolves.toStrictEqual(['1']);
        expect(logged).toHaveBeenCalledWith({ event: 'upload_redelivered', versionId });
    });
});

describe('dead-lettered uploads', () => {
    beforeEach(async () => putDay(DAY));

    /** Delivers upload events from the dead-letter queue, as the queue does once their retries are spent. */
    async function deadLetter(versionIds: string[]): Promise<string[]> {
        const batch = uploadBatch(versionIds, 'staging-uploads-dlq');
        const ctx = createExecutionContext();
        await handler.queue?.(batch, env, ctx);
        await waitOnExecutionContext(ctx);
        return (await getQueueResult(batch, ctx)).explicitAcks;
    }

    it('tells the admin an upload whose pipeline never started must be uploaded again', async () => {
        const versionId = await stage(`${DAY}stranded`, jpg);
        const started = vi.spyOn(env.UPLOAD_PIPELINE, 'create');

        await expect(deadLetter([versionId])).resolves.toStrictEqual(['1']);
        await expect(uploadErrors([`${DAY}stranded`])).resolves.toStrictEqual({
            [`${DAY}stranded`]: UNSTARTED_ERROR,
        });
        expect(started).not.toHaveBeenCalled();
    });

    it('records nothing for an upload whose instance started after all, as a long transcode may still be running', async () => {
        const versionId = await stage(`${DAY}running`, jpg);
        vi.spyOn(env.UPLOAD_PIPELINE, 'get').mockResolvedValueOnce({ id: versionId } as WorkflowInstance);

        await expect(deadLetter([versionId])).resolves.toStrictEqual(['1']);
        await expect(uploadErrors([`${DAY}running`])).resolves.toStrictEqual({});
    });

    it('records nothing for an upload that finished, or one nobody presigned', async () => {
        const versionId = await upload(`${DAY}done`, jpg);

        await expect(deadLetter([versionId, testVersionId('v1')])).resolves.toStrictEqual(['1', '2']);
        await expect(uploadErrors([`${DAY}done`])).resolves.toStrictEqual({});
    });
});

describe('video uploads', () => {
    beforeEach(async () => putDay(DAY));

    it('records a file ffmpeg rejects as an upload error instead of an item', async () => {
        standInTranscoder(rejecting);
        await upload(`${DAY}broken`, mov, { extension: 'mov' });
        const [item, errors] = await Promise.all([
            storedItem(DAY, 'broken'),
            uploadErrors([`${DAY}broken`, `${DAY}fine`]),
        ]);

        expect(item).toBeUndefined();
        expect(Object.keys(errors)).toStrictEqual([`${DAY}broken`]);
        expect(errors[`${DAY}broken`]).toBe('ffmpeg exited 1: moov atom not found');
    });

    it('clears the error once a later upload of the same path succeeds', async () => {
        standInTranscoder(rejecting);
        await upload(`${DAY}again`, mov, { extension: 'mov' });
        standInTranscoder(transcoding);
        await upload(`${DAY}again`, mov, { extension: 'mov' });
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

    it('acks the event though the transcoder cannot be reached and the retries are spent', async () => {
        standInTranscoder(async () => {
            throw new Error('container unreachable');
        });
        const versionId = await stage(`${DAY}later`, mov, { extension: 'mov' });
        const acks = await deliver(versionId, {
            until: 'errored',
            modify: async (modifier) => modifier.disableRetryDelays(),
        });

        expect(acks).toStrictEqual(['1']);
        await expect(storedItem(DAY, 'later')).resolves.toBeUndefined();
    });

    it('tries the container four times, then tells the admin why', async () => {
        let attempts = 0;
        standInTranscoder(async () => {
            attempts++;
            throw new Error('container unreachable');
        });
        const versionId = await stage(`${DAY}later`, mov, { extension: 'mov' });
        await deliver(versionId, { until: 'errored', modify: async (modifier) => modifier.disableRetryDelays() });

        expect(attempts).toBe(4);
        await expect(uploadErrors([`${DAY}later`])).resolves.toStrictEqual({
            [`${DAY}later`]: 'container unreachable',
        });
    });

    it('writes nothing twice when the event is delivered again after success, as Queues may do', async () => {
        standInTranscoder(transcoding);
        const versionId = await stage(`${DAY}clip`, mov, { extension: 'mov' });
        await deliver(versionId);
        await deliver(versionId);
        const [item, originals, media] = await Promise.all([
            storedItem(DAY, 'clip'),
            env.ORIGINALS.list({ prefix: 'originals/' }),
            mediaNames(),
        ]);

        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(versionId)]);
        expect(media).toStrictEqual([{ itemName: 'clip' }]);
    });

    it('has the container read the original and write the MP4 and poster for the version into the derived bucket', async () => {
        const versionId = await stage(`${DAY}clip`, mov, { extension: 'mov' });
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
            src: `/${env.ORIGINALS_BUCKET}/${originalKey(versionId)}`,
            mp4Put: `/${env.DERIVED_BUCKET}/${videoKey(versionId)}`,
            posterPut: `/${env.DERIVED_BUCKET}/${posterKey(versionId)}`,
        });
    });
});
