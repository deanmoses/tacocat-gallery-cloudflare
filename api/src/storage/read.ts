/** How long a read may go without a byte arriving before it is given up and tried again. */
export const READ_STALL_MS = 10_000;
const READ_TRIES = 3;

const STALLED = Symbol('stalled');

type Read = { outcome: 'read'; bytes: Uint8Array<ArrayBuffer> | null } | { outcome: 'stalled'; bytes: number };

/**
 * The object at `key`, or its first `length` bytes; null when there is none. A read that goes `READ_STALL_MS` without
 * a byte, before its body starts or partway through, is cancelled and tried again, up to three tries, each logged with
 * how far it got. Reads of the upload inbox have hung for minutes in the pipeline's Workflow, on objects that read in
 * under a second on the tries before and after, and a stream, unlike `arrayBuffer()`, can be given up on.
 */
export async function readObject(
    bucket: R2Bucket,
    key: string,
    length?: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
    for (let tried = 1; ; tried += 1) {
        const started = performance.now();
        const read = await readOnce(bucket, key, length);
        if (read.outcome === 'read') {
            return read.bytes;
        }
        console.warn({ event: 'read_stalled', key, length, tried, bytes: read.bytes, ms: performance.now() - started });
        if (tried === READ_TRIES) {
            throw new Error(`reading ${key} stalled ${String(READ_TRIES)} times`);
        }
    }
}

async function readOnce(bucket: R2Bucket, key: string, length: number | undefined): Promise<Read> {
    const pending = bucket.get(key, length === undefined ? {} : { range: { offset: 0, length } });
    const object = await withinStall(pending);
    if (object === STALLED) {
        // An answer that comes after all is not read, so its body is let go.
        void cancelLate(pending);
        return { outcome: 'stalled', bytes: 0 };
    }
    if (object === null) {
        return { outcome: 'read', bytes: null };
    }
    // Filled in place, since a photo can be 50 MB and the isolate's 128 MB is shared with whatever else runs there.
    const bytes = new Uint8Array(length === undefined ? object.size : Math.min(length, object.size));
    let received = 0;
    // An R2 body is typed as a stream of anything; passing it through as bytes types its chunks as bytes.
    const reader = object.body.pipeThrough(new IdentityTransformStream()).getReader();
    for (;;) {
        const chunk = await withinStall(reader.read());
        if (chunk === STALLED) {
            // A stalled stream may not answer its cancel either, so nothing waits on it.
            void cancelQuietly(reader);
            return { outcome: 'stalled', bytes: received };
        }
        if (chunk.done) {
            break;
        }
        bytes.set(chunk.value, received);
        received += chunk.value.byteLength;
    }
    if (received !== bytes.length) {
        throw new Error(`reading ${key} ended after ${String(received)} of ${String(bytes.length)} bytes`);
    }
    return { outcome: 'read', bytes };
}

async function cancelLate(pending: Promise<R2ObjectBody | null>): Promise<void> {
    try {
        await (await pending)?.body.cancel();
    } catch {
        // Nothing waits on it.
    }
}

async function cancelQuietly(reader: ReadableStreamDefaultReader): Promise<void> {
    try {
        await reader.cancel();
    } catch {
        // Whatever the cancel says, the read was already given up.
    }
}

async function withinStall<T>(work: Promise<T>): Promise<T | typeof STALLED> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<typeof STALLED>((resolve) => {
        timer = setTimeout(() => {
            resolve(STALLED);
        }, READ_STALL_MS);
    });
    try {
        return await Promise.race([work, stalled]);
    } finally {
        clearTimeout(timer);
    }
}
