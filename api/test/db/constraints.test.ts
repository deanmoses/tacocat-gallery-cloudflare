import { env } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { type Orm, orm, schema, upsertItem } from '../../src/db';

// Every rule about a single row is a constraint, so that no code path can write a row the rules forbid. These write
// rows straight to the tables, past the shared schema, and expect the database to refuse each one by name. Drizzle
// wraps D1's error, whose message names the constraint, as the cause.
function refusedBy(constraint: string): { cause: { message: string } } {
    return { cause: { message: expect.stringContaining(`constraint failed: ${constraint}`) } };
}

const IMAGE: schema.NewItem = {
    parentPath: '/2001/06-15/',
    itemName: 'felix.jpg',
    itemType: 'media',
    mediaType: 'image',
    versionId: 'v1',
    width: 4032,
    height: 3024,
};
const VIDEO: schema.NewItem = { ...IMAGE, itemName: 'clip.mov', mediaType: 'video', durationSeconds: 9.5 };
const DAY: schema.NewItem = { parentPath: '/2001/', itemName: '06-15', itemType: 'album' };
const YEAR: schema.NewItem = { parentPath: '/', itemName: '2001', itemType: 'album' };
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/v;

function database(): Orm {
    return orm(env.DB);
}

describe('an item row', () => {
    it.each<{ name: string; row: Record<string, unknown>; constraint: string }>([
        { name: 'an unknown item type', row: { ...DAY, itemType: 'gif' }, constraint: 'item_type_check' },
        {
            name: 'an album with a media type',
            row: { ...DAY, mediaType: 'image' },
            constraint: 'item_media_type_check',
        },
        { name: 'media without a media type', row: { ...IMAGE, mediaType: null }, constraint: 'item_media_type_check' },
        { name: 'an album named as a word', row: { ...YEAR, itemName: 'tacos' }, constraint: 'item_path_check' },
        { name: 'a day album in the root', row: { ...DAY, parentPath: '/' }, constraint: 'item_path_check' },
        { name: 'a year album in a year', row: { ...YEAR, parentPath: '/2001/' }, constraint: 'item_path_check' },
        { name: 'an album in a day', row: { ...DAY, parentPath: '/2001/06-15/' }, constraint: 'item_path_check' },
        { name: 'media in a year album', row: { ...IMAGE, parentPath: '/2001/' }, constraint: 'item_path_check' },
        { name: 'media in the root', row: { ...IMAGE, parentPath: '/' }, constraint: 'item_path_check' },
        { name: 'a media name with two dots', row: { ...IMAGE, itemName: 'a.b.jpg' }, constraint: 'item_path_check' },
        { name: 'a media name with no dot', row: { ...IMAGE, itemName: 'felix' }, constraint: 'item_path_check' },
        {
            name: 'a media name with a slash',
            row: { ...IMAGE, itemName: 'x/felix.jpg' },
            constraint: 'item_path_check',
        },
        {
            name: 'a media name that is an extension',
            row: { ...IMAGE, itemName: '.jpg' },
            constraint: 'item_path_check',
        },
        { name: 'an album with a version', row: { ...DAY, versionId: 'v1' }, constraint: 'item_file_check' },
        { name: 'an album with a size', row: { ...DAY, width: 1, height: 1 }, constraint: 'item_file_check' },
        { name: 'media without a version', row: { ...IMAGE, versionId: null }, constraint: 'item_file_check' },
        { name: 'media with a blank version', row: { ...IMAGE, versionId: '' }, constraint: 'item_file_check' },
        { name: 'a version with a slash', row: { ...IMAGE, versionId: 'a/b' }, constraint: 'item_file_check' },
        { name: 'a version with a plus', row: { ...IMAGE, versionId: 'a+b' }, constraint: 'item_file_check' },
        { name: 'media without a width', row: { ...IMAGE, width: null }, constraint: 'item_file_check' },
        { name: 'media with a height of zero', row: { ...IMAGE, height: 0 }, constraint: 'item_file_check' },
        { name: 'an image with a duration', row: { ...IMAGE, durationSeconds: 1 }, constraint: 'item_duration_check' },
        {
            name: 'a video without a duration',
            row: { ...VIDEO, durationSeconds: null },
            constraint: 'item_duration_check',
        },
        { name: 'a video of no length', row: { ...VIDEO, durationSeconds: 0 }, constraint: 'item_duration_check' },
        { name: 'an album with a title', row: { ...DAY, title: 'Felix' }, constraint: 'item_caption_check' },
        { name: 'an album with tags', row: { ...DAY, tags: ['cat'] }, constraint: 'item_caption_check' },
        { name: 'media with a summary', row: { ...IMAGE, summary: 'A day' }, constraint: 'item_caption_check' },
        { name: 'a blank title', row: { ...IMAGE, title: ' ' }, constraint: 'item_caption_check' },
        { name: 'a blank description', row: { ...DAY, description: '' }, constraint: 'item_caption_check' },
        { name: 'a blank summary', row: { ...DAY, summary: '\t' }, constraint: 'item_caption_check' },
        { name: 'tags that are not a list', row: { ...IMAGE, tags: 'cat' }, constraint: 'item_tags_check' },
        { name: 'an empty list of tags', row: { ...IMAGE, tags: [] }, constraint: 'item_tags_check' },
        { name: 'media marked published', row: { ...IMAGE, published: true }, constraint: 'item_published_check' },
        {
            name: 'an album with a crop',
            row: { ...DAY, thumbnailCrop: { x: 0, y: 0, width: 1, height: 1 } },
            constraint: 'item_thumbnail_check',
        },
        { name: 'media with a thumbnail id', row: { ...IMAGE, thumbnailId: 1 }, constraint: 'item_thumbnail_check' },
        {
            name: 'a crop that is not an object',
            row: { ...IMAGE, thumbnailCrop: [1, 2, 3, 4] },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop with a side missing',
            row: { ...IMAGE, thumbnailCrop: { x: 0, y: 0, width: 1 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop with a side as text',
            row: { ...IMAGE, thumbnailCrop: { x: 0, y: 0, width: '1', height: 1 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop left of the image',
            row: { ...IMAGE, thumbnailCrop: { x: -1, y: 0, width: 1, height: 1 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop with no area',
            row: { ...IMAGE, thumbnailCrop: { x: 0, y: 0, width: 0, height: 1 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop past the right edge',
            row: { ...IMAGE, thumbnailCrop: { x: 4000, y: 0, width: 33, height: 1 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a crop past the bottom edge',
            row: { ...IMAGE, thumbnailCrop: { x: 0, y: 3000, width: 1, height: 25 } },
            constraint: 'item_thumbnail_check',
        },
        {
            name: 'a creation time in another format',
            row: { ...IMAGE, createdAt: '2001-06-15 12:00:00' },
            constraint: 'item_created_at_format',
        },
        {
            name: 'a creation time that is no date',
            row: { ...IMAGE, createdAt: '2001-13-45T12:00:00.000Z' },
            constraint: 'item_created_at_format',
        },
        {
            name: 'an update time in another format',
            row: { ...IMAGE, updatedAt: '2001-06-15' },
            constraint: 'item_updated_at_format',
        },
        {
            name: 'a change before the making',
            row: { ...IMAGE, createdAt: '2001-06-15T12:00:00.000Z', updatedAt: '2001-06-15T11:59:59.999Z' },
            constraint: 'item_updated_after_created',
        },
    ])('refuses $name', async ({ row, constraint }) => {
        const insert = database()
            .insert(schema.item)
            .values(row as schema.NewItem)
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy(constraint));
    });

    it.each([
        {
            name: 'a crop that just fits',
            row: { ...IMAGE, thumbnailCrop: { x: 32, y: 24, width: 4000, height: 3000 } },
        },
        {
            name: 'a crop with fractional sides',
            row: { ...IMAGE, thumbnailCrop: { x: 0.5, y: 0.5, width: 1.5, height: 1.5 } },
        },
        { name: 'a version as AWS assigned them', row: { ...IMAGE, versionId: 'AbC.123_xyz-9' } },
        { name: 'a media name with spaces and accents', row: { ...IMAGE, itemName: 'félix at the beach.JPG' } },
        { name: 'a video', row: VIDEO },
        { name: 'a published album with a summary', row: { ...DAY, summary: 'Felix turns one', published: true } },
    ])('accepts $name', async ({ row }) => {
        const insert = database().insert(schema.item).values(row).run();

        await expect(insert).resolves.toMatchObject({ meta: { changes: expect.any(Number) } });
    });

    it('is made and changed at the same moment, in the format the checks expect', async () => {
        const [row] = await database().insert(schema.item).values(IMAGE).returning();

        expect(row?.createdAt).toMatch(TIMESTAMP);
        expect(row?.updatedAt).toBe(row?.createdAt);
    });

    it('moves its update time on an update through the query builder', async () => {
        const { item } = schema;
        const [before] = await database().insert(schema.item).values(IMAGE).returning();
        // SQLite's clock has millisecond resolution, so an update lands in a later millisecond soon enough.
        await vi.waitFor(async () => {
            await database()
                .update(item)
                .set({ title: 'Felix' })
                .where(eq(item.id, before?.id ?? 0))
                .run();
            const after = await database()
                .select()
                .from(item)
                .where(eq(item.id, before?.id ?? 0))
                .get();

            // Timestamps in one format compare as text.
            expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(before?.updatedAt ?? ''));
            expect(after?.createdAt).toBe(before?.createdAt);
        });
    });

    it('is created and given a thumbnail in one batch', async () => {
        const db = database();
        const media = { parentPath: `${DAY.parentPath}${DAY.itemName}/`, itemName: 'first.jpg' };
        await db.batch([
            upsertItem(db, { ...IMAGE, ...media }),
            upsertItem(db, DAY),
            db
                .update(schema.item)
                .set({
                    thumbnailId: sql`(${db.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.itemName, 'first.jpg'))})`,
                })
                .where(eq(schema.item.itemName, DAY.itemName)),
        ]);
        const day = await db.select().from(schema.item).where(eq(schema.item.itemName, DAY.itemName)).get();

        expect(day?.thumbnailId).toBeTypeOf('number');
        expect(Date.parse(day?.updatedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(day?.createdAt ?? ''));
    });

    it('loses its thumbnail when the media it shows is deleted', async () => {
        const db = database();
        const { item } = schema;
        const [media] = await db.insert(item).values(IMAGE).returning();
        await db.insert(item).values({ ...DAY, thumbnailId: media?.id });
        await db
            .delete(item)
            .where(eq(item.id, media?.id ?? 0))
            .run();
        const day = await db.select().from(item).where(eq(item.itemName, DAY.itemName)).get();

        expect(day).toMatchObject({ itemName: DAY.itemName, thumbnailId: null });
    });

    it('cannot point at a thumbnail row that does not exist', async () => {
        const insert = database()
            .insert(schema.item)
            .values({ ...DAY, thumbnailId: 404 })
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy(''));
    });
});

describe('an upload row', () => {
    const UPLOAD: typeof schema.upload.$inferInsert = {
        versionId: 'v1',
        parentPath: '/2001/06-15/',
        itemName: 'felix.jpg',
        username: 'moses',
    };

    it.each<{ name: string; row: Record<string, unknown>; constraint: string }>([
        { name: 'a blank version', row: { ...UPLOAD, versionId: '' }, constraint: 'upload_version_id_format' },
        {
            name: 'a version with a slash',
            row: { ...UPLOAD, versionId: 'a/b' },
            constraint: 'upload_version_id_format',
        },
        {
            name: 'an upload into a year album',
            row: { ...UPLOAD, parentPath: '/2001/' },
            constraint: 'upload_path_check',
        },
        {
            name: 'an upload named with two dots',
            row: { ...UPLOAD, itemName: 'a.b.jpg' },
            constraint: 'upload_path_check',
        },
        {
            name: 'a target path that is an album',
            row: { ...UPLOAD, targetPath: '/2001/06-15/' },
            constraint: 'upload_target_check',
        },
        {
            name: 'a completion in another format',
            row: { ...UPLOAD, completedAt: 'yesterday' },
            constraint: 'upload_completed_at_format',
        },
        { name: 'a user that does not exist', row: { ...UPLOAD, username: 'nobody' }, constraint: '' },
    ])('refuses $name', async ({ row, constraint }) => {
        const insert = database()
            .insert(schema.upload)
            .values(row as typeof schema.upload.$inferInsert)
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy(constraint));
    });

    it('refuses a target id without a path', async () => {
        const db = database();
        const [media] = await db.insert(schema.item).values(IMAGE).returning();
        const insert = db
            .insert(schema.upload)
            .values({ ...UPLOAD, targetId: media?.id })
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy('upload_target_check'));
    });

    it('is cleared of an album that is deleted before it finishes', async () => {
        const db = database();
        const [day] = await db.insert(schema.item).values(DAY).returning();
        await db.insert(schema.upload).values({ ...UPLOAD, versionId: 'v3', albumId: day?.id });
        await db
            .delete(schema.item)
            .where(eq(schema.item.id, day?.id ?? 0))
            .run();
        const upload = await db.select().from(schema.upload).where(eq(schema.upload.versionId, 'v3')).get();

        expect(upload).toMatchObject({ albumId: null, parentPath: '/2001/06-15/' });
    });

    it('keeps saying it was a replacement after its target is deleted', async () => {
        const db = database();
        const [media] = await db.insert(schema.item).values(IMAGE).returning();
        const targetPath = IMAGE.parentPath + IMAGE.itemName;
        await db.insert(schema.upload).values({ ...UPLOAD, versionId: 'v2', targetId: media?.id, targetPath });
        await db
            .delete(schema.item)
            .where(eq(schema.item.id, media?.id ?? 0))
            .run();
        const upload = await db.select().from(schema.upload).where(eq(schema.upload.versionId, 'v2')).get();

        expect(upload).toMatchObject({ targetId: null, targetPath });
    });
});

describe('the other rows', () => {
    it.each<{ name: string; insert: () => Promise<unknown>; constraint: string }>([
        {
            name: 'an upload error for an album',
            insert: async () =>
                database().insert(schema.uploadError).values({ path: '/2001/06-15/', message: 'x' }).run(),
            constraint: 'upload_error_path_check',
        },
        {
            name: 'an upload error with no message',
            insert: async () =>
                database().insert(schema.uploadError).values({ path: '/2001/06-15/a.jpg', message: ' ' }).run(),
            constraint: 'upload_error_message_check',
        },
        {
            name: 'a user with a capital letter',
            insert: async () => database().insert(schema.user).values({ username: 'Moses' }).run(),
            constraint: 'user_username_format',
        },
        {
            name: 'a user starting with a digit',
            insert: async () => database().insert(schema.user).values({ username: '1moses' }).run(),
            constraint: 'user_username_format',
        },
        {
            name: 'a passkey with a negative count',
            insert: async () =>
                database()
                    .insert(schema.passkey)
                    .values({ credentialId: 'c', username: 'moses', publicKey: 'k', counter: -1 })
                    .run(),
            constraint: 'passkey_counter_check',
        },
        {
            name: 'a passkey with no key',
            insert: async () =>
                database().insert(schema.passkey).values({ credentialId: 'c', username: 'moses', publicKey: '' }).run(),
            constraint: 'passkey_public_key_check',
        },
        {
            name: 'an invite with a short hash',
            insert: async () =>
                database()
                    .insert(schema.invite)
                    .values({ tokenHash: 'abc', username: 'moses', expiresAt: '2999-01-01T00:00:00.000Z' })
                    .run(),
            constraint: 'invite_token_hash_format',
        },
        {
            name: 'an invite expiring at no time',
            insert: async () =>
                database()
                    .insert(schema.invite)
                    .values({ tokenHash: 'a'.repeat(64), username: 'moses', expiresAt: 'never' })
                    .run(),
            constraint: 'invite_expires_at_format',
        },
        {
            name: 'a spent challenge expiring at no time',
            insert: async () =>
                database().insert(schema.spentChallenge).values({ challenge: 'c', expiresAt: '2999' }).run(),
            constraint: 'spent_challenge_expires_at_format',
        },
        {
            name: 'a probe result with an impossible status',
            insert: async () =>
                database()
                    .insert(schema.probeResult)
                    .values({ runAt: 'r', location: 'l', seq: 0, path: '/', status: 42 })
                    .run(),
            constraint: 'probe_result_status_check',
        },
        {
            name: 'a probe result with a negative timing',
            insert: async () =>
                database()
                    .insert(schema.probeResult)
                    .values({ runAt: 'r', location: 'l', seq: 0, path: '/', tlsMs: -1 })
                    .run(),
            constraint: 'probe_result_timings_check',
        },
        {
            name: 'a probe result out of sequence',
            insert: async () =>
                database().insert(schema.probeResult).values({ runAt: 'r', location: 'l', seq: -1, path: '/' }).run(),
            constraint: 'probe_result_seq_check',
        },
    ])('refuse $name', async ({ insert, constraint }) => {
        await expect(insert()).rejects.toMatchObject(refusedBy(constraint));
    });
});
