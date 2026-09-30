// What every script that writes the copy from AWS shares, so that none of them runs away. A script touches only the
// albums it is named with --only, or everything when told --all, and one given neither or both stops before it
// starts. It writes nothing without --go. It tries a request again when R2 or the Worker drops it, and stops the
// whole run on the first sign of a fault every later request would meet too: a refused credential, or a request that
// failed every attempt. Anything else that goes wrong with one item counts against a limit, and reaching it stops the
// run as well.
import { parsePath } from '@tacocat-gallery/shared';

export type Scope = { all: true } | { all: false; albums: string[] };

/** The scope the arguments name: --all, or one or more `--only <album path>`, never both and never neither. */
export function parseScope(args: readonly string[]): Scope {
    const albums = values(args, '--only');
    const all = args.includes('--all');
    if (all === albums.length > 0) {
        throw new Error('Name what to touch: --only <album path>, as often as needed, or --all, and not both');
    }
    for (const album of albums) {
        const kind = parsePath(album)?.kind;
        if (kind !== 'year' && kind !== 'day') {
            throw new Error(`--only takes a year or day album path, such as /2010/ or /2010/10-10/: [${album}]`);
        }
    }
    return all ? { all } : { all, albums };
}

/** Whether a path lies inside one of the scope's albums. */
export function inScope(scope: Scope, path: string): boolean {
    return scope.all || scope.albums.some((album) => path.startsWith(album));
}

/** Whether an album is in the scope or holds an album that is, as a day album's year has to exist before the day. */
export function albumInScope(scope: Scope, album: string): boolean {
    return scope.all || scope.albums.some((named) => named.startsWith(album) || album.startsWith(named));
}

export type Target = 'local' | 'staging' | 'production';

/** The target `--to` names, which every run has to name, from those the script can write to. */
export function parseTarget<T extends Target>(args: readonly string[], allowed: readonly T[]): T {
    const named = value(args, '--to');
    const target = allowed.find((candidate) => candidate === named);
    if (target === undefined) {
        throw new Error(`Name the target with --to ${allowed.join('|')}`);
    }
    return target;
}

/** The value after the flag's first appearance. */
export function value(args: readonly string[], flag: string): string | undefined {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
}

function values(args: readonly string[], flag: string): string[] {
    return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : []));
}

/** A run's failures, and why it stopped once it has. */
export class Guard {
    readonly #maxFailures: number;
    #failures = 0;
    #halted: string | null = null;

    constructor(maxFailures: number) {
        this.#maxFailures = maxFailures;
    }

    get failures(): number {
        return this.#failures;
    }

    /** Why the run stopped, or null while it goes on. */
    get halted(): string | null {
        return this.#halted;
    }

    /**
     * One item went wrong; the run stops when that makes the limit. One already under way when it stopped still counts.
     */
    fail(what: string): void {
        this.#failures += 1;
        if (this.#halted !== null) {
            console.error(`failure after stopping: ${what}`);
            return;
        }
        console.error(`failure ${String(this.#failures)} of at most ${String(this.#maxFailures)}: ${what}`);
        if (this.#failures >= this.#maxFailures) {
            this.halt(`${String(this.#maxFailures)} failures`);
        }
    }

    halt(reason: string): void {
        if (this.#halted !== null) {
            return;
        }
        this.#halted = reason;
        console.error(`STOPPING: ${reason}`);
    }
}

const ATTEMPTS = 3;
const RETRY_MS = 2000;

/**
 * The response to a request, sent again after a pause when the answer is a 429 or a 5xx or the connection fails. A
 * 401 or a 403 stops the run, since every request after it would be refused too, and so does a request that fails
 * every attempt. Null once the run has stopped; any other answer is the caller's to judge.
 */
export async function send(
    guard: Guard,
    label: string,
    request: () => Promise<Response>,
    pause: (ms: number) => Promise<void> = sleep,
): Promise<Response | null> {
    let last = '';
    for (let attempt = 1; attempt <= ATTEMPTS && guard.halted === null; attempt += 1) {
        if (attempt > 1) {
            await pause(RETRY_MS * (attempt - 1));
        }
        let response: Response;
        try {
            response = await request();
        } catch (error) {
            last = error instanceof Error ? error.message : String(error);
            continue;
        }
        if (response.status === 401 || response.status === 403) {
            guard.halt(`${label}: ${String(response.status)} ${await response.text()}`);
            return null;
        }
        if (response.status !== 429 && response.status < 500) {
            return response;
        }
        last = `${String(response.status)} ${await response.text()}`;
    }
    guard.halt(`${label}: ${last} after ${String(ATTEMPTS)} attempts`);
    return null;
}

/** Works through the items, `atOnce` at a time, starting none once the run has stopped. */
export async function inParallel<T>(
    guard: Guard,
    items: readonly T[],
    atOnce: number,
    work: (item: T) => Promise<void>,
): Promise<void> {
    const queue = [...items];
    await Promise.all(
        Array.from({ length: atOnce }, async () => {
            for (let next = queue.shift(); next !== undefined && guard.halted === null; next = queue.shift()) {
                await work(next);
            }
        }),
    );
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
