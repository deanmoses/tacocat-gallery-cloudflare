import { env } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { type Orm, orm, schema, upsertItem } from '../../src/db';
import { testVersionId } from '../version-id';

// Every rule about a single row is a constraint, so that no code path can write a row the rules forbid. These write
// rows straight to the tables, past the shared schema, and expect the database to refuse each one by name. Drizzle
// wraps D1's error, whose message names the constraint, as the cause.
function refusedBy(constraint: string): { cause: { message: string } } {
    return { cause: { message: expect.stringContaining(`constraint failed: ${constraint}`) } };
}

/** The ULID from the spec's own README. */
const ULID = '01ARYZ6S41TSV4RRFFQ69G5FAV';

const IMAGE: schema.NewItem = {
    parentPath: '/2001/06-15/',
    itemName: 'felix',
    itemType: 'media',
    mediaType: 'image',
    versionId: testVersionId('v1'),
    width: 4032,
    height: 3024,
};
const VIDEO: schema.NewItem = { ...IMAGE, itemName: 'clip', mediaType: 'video', durationSeconds: 9.5 };
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
        {
            name: 'a media name with an extension',
            row: { ...IMAGE, itemName: 'felix.jpg' },
            constraint: 'item_path_check',
        },
        { name: 'a media name with a capital', row: { ...IMAGE, itemName: 'Felix' }, constraint: 'item_path_check' },
        { name: 'a media name with a hyphen', row: { ...IMAGE, itemName: 'felix-1' }, constraint: 'item_path_check' },
        {
            name: 'a media name with two underscores in a row',
            row: { ...IMAGE, itemName: 'felix__1' },
            constraint: 'item_path_check',
        },
        {
            name: 'a media name ending in an underscore',
            row: { ...IMAGE, itemName: 'felix_' },
            constraint: 'item_path_check',
        },
        { name: 'a media name with a slash', row: { ...IMAGE, itemName: 'x/felix' }, constraint: 'item_path_check' },
        { name: 'a day the calendar does not have', row: { ...DAY, itemName: '02-30' }, constraint: 'item_path_check' },
        {
            name: 'a leap day outside a leap year',
            row: { ...DAY, parentPath: '/2001/', itemName: '02-29' },
            constraint: 'item_path_check',
        },
        {
            name: 'media in a day the calendar does not have',
            row: { ...IMAGE, parentPath: '/2001/02-30/' },
            constraint: 'item_path_check',
        },
        { name: 'an album with a version', row: { ...DAY, versionId: ULID }, constraint: 'item_file_check' },
        { name: 'an album with a size', row: { ...DAY, width: 1, height: 1 }, constraint: 'item_file_check' },
        { name: 'media without a version', row: { ...IMAGE, versionId: null }, constraint: 'item_file_check' },
        { name: 'media with a blank version', row: { ...IMAGE, versionId: '' }, constraint: 'item_file_check' },
        { name: 'a version with a slash', row: { ...IMAGE, versionId: 'a/b' }, constraint: 'item_file_check' },
        {
            name: 'a version as AWS assigned them',
            row: { ...IMAGE, versionId: 'AbC.123_xyz-9' },
            constraint: 'item_file_check',
        },
        {
            name: 'a version in lowercase',
            row: { ...IMAGE, versionId: ULID.toLowerCase() },
            constraint: 'item_file_check',
        },
        {
            name: 'a version a character short',
            row: { ...IMAGE, versionId: ULID.slice(1) },
            constraint: 'item_file_check',
        },
        {
            name: 'a version with a letter Crockford leaves out',
            row: { ...IMAGE, versionId: `${ULID.slice(0, 25)}I` },
            constraint: 'item_file_check',
        },
        {
            name: 'a version whose timestamp is past 48 bits',
            row: { ...IMAGE, versionId: `8${ULID.slice(1)}` },
            constraint: 'item_file_check',
        },
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
        { name: 'an album with a place', row: { ...DAY, position: 0 }, constraint: 'item_position_check' },
        { name: 'media at a negative place', row: { ...IMAGE, position: -1 }, constraint: 'item_position_check' },
        { name: 'media at a fractional place', row: { ...IMAGE, position: 1.5 }, constraint: 'item_position_check' },
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
        { name: 'a ULID', row: { ...IMAGE, versionId: ULID } },
        { name: 'a media name with digits and underscores', row: { ...IMAGE, itemName: 'img_0001_2' } },
        { name: 'a video', row: VIDEO },
        { name: 'a published album with a summary', row: { ...DAY, summary: 'Felix turns one', published: true } },
        { name: 'media in the first place', row: { ...IMAGE, position: 0 } },
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
        const media = { parentPath: `${DAY.parentPath}${DAY.itemName}/`, itemName: 'first' };
        await db.batch([
            upsertItem(db, { ...IMAGE, ...media }),
            upsertItem(db, DAY),
            db
                .update(schema.item)
                .set({
                    thumbnailId: sql`(${db.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.itemName, 'first'))})`,
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

    it('cannot share its place in the album with another media item', async () => {
        const db = database();
        await db.insert(schema.item).values({ ...IMAGE, position: 3 });
        const insert = db
            .insert(schema.item)
            .values({ ...IMAGE, itemName: 'milo', versionId: testVersionId('v2'), position: 3 })
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy('item.parent_path, item.position'));
    });

    it('can take the place a media item in another album has', async () => {
        const db = database();
        await db.insert(schema.item).values({ ...IMAGE, position: 3 });
        const insert = db
            .insert(schema.item)
            .values({ ...IMAGE, parentPath: '/2001/06-16/', versionId: testVersionId('v2'), position: 3 })
            .run();

        await expect(insert).resolves.toMatchObject({ success: true });
    });

    it('cannot share its file with another media item', async () => {
        const db = database();
        await db.insert(schema.item).values(IMAGE);
        const insert = db
            .insert(schema.item)
            .values({ ...IMAGE, parentPath: '/2001/06-16/' })
            .run();

        await expect(insert).rejects.toMatchObject(refusedBy('item.version_id'));
    });

    it('can be one of many albums without a file', async () => {
        const db = database();
        await db.insert(schema.item).values(YEAR);
        const insert = db.insert(schema.item).values(DAY).run();

        await expect(insert).resolves.toMatchObject({ success: true });
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
        versionId: testVersionId('v1'),
        parentPath: '/2001/06-15/',
        itemName: 'felix',
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
            name: 'a version in lowercase',
            row: { ...UPLOAD, versionId: ULID.toLowerCase() },
            constraint: 'upload_version_id_format',
        },
        {
            name: 'a version a character long',
            row: { ...UPLOAD, versionId: `${ULID}V` },
            constraint: 'upload_version_id_format',
        },
        {
            name: 'an upload into a year album',
            row: { ...UPLOAD, parentPath: '/2001/' },
            constraint: 'upload_path_check',
        },
        {
            name: 'an upload named with an extension',
            row: { ...UPLOAD, itemName: 'felix.jpg' },
            constraint: 'upload_path_check',
        },
        {
            name: 'an upload named with a capital',
            row: { ...UPLOAD, itemName: 'Felix' },
            constraint: 'upload_path_check',
        },
        {
            name: 'an upload into a day the calendar does not have',
            row: { ...UPLOAD, parentPath: '/2001/02-30/' },
            constraint: 'upload_path_check',
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

    it('refuses a target id on an upload that is no replacement', async () => {
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
        await db.insert(schema.upload).values({ ...UPLOAD, versionId: testVersionId('v3'), albumId: day?.id });
        await db
            .delete(schema.item)
            .where(eq(schema.item.id, day?.id ?? 0))
            .run();
        const upload = await db
            .select()
            .from(schema.upload)
            .where(eq(schema.upload.versionId, testVersionId('v3')))
            .get();

        expect(upload).toMatchObject({ albumId: null, parentPath: '/2001/06-15/' });
    });

    it('keeps saying it was a replacement after its target is deleted', async () => {
        const db = database();
        const [media] = await db.insert(schema.item).values(IMAGE).returning();
        await db
            .insert(schema.upload)
            .values({ ...UPLOAD, versionId: testVersionId('v2'), replacement: true, targetId: media?.id });
        await db
            .delete(schema.item)
            .where(eq(schema.item.id, media?.id ?? 0))
            .run();
        const upload = await db
            .select()
            .from(schema.upload)
            .where(eq(schema.upload.versionId, testVersionId('v2')))
            .get();

        expect(upload).toMatchObject({ targetId: null, replacement: true });
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
            name: 'an upload error for a name with a capital',
            insert: async () =>
                database().insert(schema.uploadError).values({ path: '/2001/06-15/A', message: 'x' }).run(),
            constraint: 'upload_error_path_check',
        },
        {
            name: 'an upload error with no message',
            insert: async () =>
                database().insert(schema.uploadError).values({ path: '/2001/06-15/a', message: ' ' }).run(),
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
    ])('refuse $name', async ({ insert, constraint }) => {
        await expect(insert()).rejects.toMatchObject(refusedBy(constraint));
    });
});
