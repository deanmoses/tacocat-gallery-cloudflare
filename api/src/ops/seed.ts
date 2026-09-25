import { type ItemUpsert, type Orm, orm, upsertItem } from '../db';
import { json } from '../http/responses';
import { inSequence } from '../util/sequence';

const SEED_WORDS = ['beach', 'birthday', 'snow', 'cat', 'taco', 'paris', 'marseille', 'hike', 'garden', 'soccer'];

/** Seeds synthetic years of albums and images so reads and search run against a gallery-sized table. */
export async function seed(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const years = Number(url.searchParams.get('years') ?? '3');
    const database = orm(env.DB);
    const statements = Array.from({ length: years })
        .keys()
        .flatMap((yearIndex) => seedYear(database, yearIndex))
        .toArray();
    // D1 caps statements per batch, so they go in batches well under it, one at a time.
    await inSequence(chunks(statements, 400), async (batch) => database.batch(batch));
    return json({ written: statements.length });
}

/** `items` in consecutive groups of at most `size`. */
function chunks<T>(items: readonly T[], size: number): [T, ...T[]][] {
    const [first, ...rest] = items.slice(0, size);
    return first === undefined ? [] : [[first, ...rest], ...chunks(items.slice(size), size)];
}

function seedYear(database: Orm, yearIndex: number): ItemUpsert[] {
    const year = String(2000 + yearIndex);
    const statements: ItemUpsert[] = [
        upsertItem(database, { parentPath: '/', itemName: year, itemType: 'album', published: true }),
    ];
    for (let dayIndex = 0; dayIndex < 60; dayIndex += 1) {
        const day = `${String((dayIndex % 12) + 1).padStart(2, '0')}-${String((dayIndex % 28) + 1).padStart(2, '0')}`;
        statements.push(
            upsertItem(database, { parentPath: `/${year}/`, itemName: day, itemType: 'album', published: true }),
        );
        for (let imageIndex = 0; imageIndex < 20; imageIndex += 1) {
            const word = SEED_WORDS[(yearIndex + dayIndex + imageIndex) % SEED_WORDS.length] ?? '';
            statements.push(
                upsertItem(database, {
                    parentPath: `/${year}/${day}/`,
                    itemName: `img_${imageIndex}.jpg`,
                    itemType: 'media',
                    mediaType: 'image',
                    title: `${word} ${imageIndex}`,
                    description: `A photo about ${word} on ${year}-${day}`,
                    tags: [word],
                    versionId: crypto.randomUUID(),
                    width: 4032,
                    height: 3024,
                }),
            );
        }
    }
    return statements;
}
