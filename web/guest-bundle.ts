import path from 'node:path';
import type { Plugin, Rolldown } from 'vite';

type OutputChunk = Rolldown.OutputChunk;

const REPO = path.resolve(import.meta.dirname, '..');

/**
 * The routes only an admin uses, or that lead to becoming one. Every other route is a guest's, and what its page
 * loads up front is what a guest downloads.
 */
const ADMIN_ROUTES = [
    'web/src/routes/login/',
    'web/src/routes/invite/',
    'web/src/routes/[year=year]/[day=day]/[media=media]/crop/',
];

/**
 * Code only an admin runs, which a guest's page reaches only through a dynamic import. `shared/src/item.ts` is the
 * schemas of what an admin writes.
 */
const ADMIN_MODULES = [
    'web/src/lib/utils/adminApi.ts',
    'web/src/lib/utils/passkeys.ts',
    'web/src/lib/stores/admin/',
    'shared/src/item.ts',
    'node_modules/@simplewebauthn/',
    'node_modules/quill/',
    'node_modules/svelte-dnd-action/',
    'node_modules/svelte-easy-crop/',
];

/** A module id as a path from the repo's root, without the query Vite adds to the parts of a Svelte file. */
function repoPath(id: string): string {
    return path.relative(REPO, id.split('?', 1)[0] ?? id);
}

function isAdminRoute(module: string): boolean {
    return ADMIN_ROUTES.some((route) => module.startsWith(route));
}

/** The routes whose pages start from an entry chunk; none for the app's own start. */
function routesOf(chunk: OutputChunk): string[] {
    return Object.keys(chunk.modules)
        .map(repoPath)
        .filter((module) => module.startsWith('web/src/routes/'));
}

/** Where a guest's page starts from: the app's own start, or the entry chunk of a guest's route, by its name. */
function guestStarts(chunks: Map<string, OutputChunk>): Map<string, string> {
    const starts = new Map<string, string>();
    for (const chunk of chunks.values()) {
        const routes = routesOf(chunk);
        if (chunk.isEntry && !routes.some(isAdminRoute)) {
            starts.set(chunk.fileName, routes.length === 0 ? "the app's start" : routes.join(', '));
        }
    }
    return starts;
}

/** Each chunk a guest's page loads without a dynamic import, with the start that first reached it. */
function guestChunks(chunks: Map<string, OutputChunk>): Map<string, string> {
    const reached = new Map<string, string>();
    const pending = [...guestStarts(chunks)];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const [fileName, start] = next;
        const chunk = chunks.get(fileName);
        if (chunk === undefined || reached.has(fileName)) {
            continue;
        }
        reached.set(fileName, start);
        pending.push(...chunk.imports.map((imported): [string, string] => [imported, start]));
    }
    return reached;
}

/** What a guest would download that only an admin needs, one line each. */
function guestBundleFindings(chunks: Map<string, OutputChunk>): string[] {
    return [...guestChunks(chunks)].flatMap(([fileName, start]) =>
        Object.keys(chunks.get(fileName)?.modules ?? {})
            .map(repoPath)
            .filter((module) => ADMIN_MODULES.some((admin) => module.startsWith(admin)))
            .map((module) => `${module} in ${fileName}, which ${start} loads`),
    );
}

/**
 * What would let the check pass without looking: no guest page found to start from, or an admin module that is in no
 * chunk, as a renamed file would be. Either means the lists or the bundler's output no longer match what this reads.
 */
function blindSpots(chunks: Map<string, OutputChunk>): string[] {
    const starts = [...guestStarts(chunks).values()];
    const modules = [...chunks.values()].flatMap((chunk) => Object.keys(chunk.modules).map(repoPath));
    return [
        ...(starts.includes("the app's start") ? [] : ["no entry chunk is the app's start"]),
        ...(starts.some((start) => start !== "the app's start") ? [] : ["no entry chunk is a guest's route"]),
        ...ADMIN_MODULES.filter((admin) => modules.every((module) => !module.startsWith(admin))).map(
            (admin) => `${admin} is in no chunk of the build`,
        ),
    ];
}

/**
 * Fails the build when a guest's page would download admin code. Admin code reaches a guest's page only through a
 * dynamic import, so it loads once someone logs in; a static import anywhere on the way pulls it into every guest's
 * first load. Chunks are checked as the bundler emits them, before minifying, so dead code the bundler kept counts.
 */
export function guestBundle(): Plugin {
    return {
        name: 'guest-bundle',
        apply: 'build',
        applyToEnvironment: (environment) => environment.config.consumer === 'client',
        generateBundle(_options, bundle): void {
            const chunks = new Map(
                Object.values(bundle)
                    .filter((output) => output.type === 'chunk')
                    .map((chunk) => [chunk.fileName, chunk]),
            );
            const blind = blindSpots(chunks);
            if (blind.length > 0) {
                throw new Error(`The guest bundle check cannot see what it checks:\n  ${blind.join('\n  ')}`);
            }
            const findings = guestBundleFindings(chunks);
            if (findings.length > 0) {
                throw new Error(`A guest's page would load admin-only code:\n  ${findings.join('\n  ')}`);
            }
        },
    };
}
