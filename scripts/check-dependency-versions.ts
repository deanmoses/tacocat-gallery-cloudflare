// Fails when a package that more than one workspace declares is declared with different ranges, or when the workspaces
// declaring it would load different copies of it, even copies of the same version. Two copies of a package whose types
// cross a workspace boundary break quietly: a valibot schema built in shared/ against one copy does not type-check, or
// does not validate, against the Worker's copy. npm dedupes them today, but a hand edit to one package.json or an
// `npm install <package> --workspace <name>` can leave a workspace its own. Reads package-lock.json, which is what
// `npm ci` installs, so it needs no node_modules.
//
// Usage: node scripts/check-dependency-versions.ts

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as valibot from 'valibot';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Packages whose workspaces are allowed their own versions, with why. Listing one that has come back together fails
 * too, so the exception does not outlive its reason.
 */
const SPLIT: ReadonlyMap<string, string> = new Map([
    ['vitest', "@cloudflare/vitest-plugin, which runs api/'s tests in workerd, supports Vitest 4 only; web/ is on 5"],
    ['@vitest/coverage-istanbul', 'must match the Vitest major of the workspace that runs it'],
]);

const RANGES = valibot.optional(valibot.record(valibot.string(), valibot.string()), {});
const MANIFEST = valibot.object({
    workspaces: valibot.optional(valibot.array(valibot.string()), []),
    dependencies: RANGES,
    devDependencies: RANGES,
    optionalDependencies: RANGES,
    peerDependencies: RANGES,
});
type Manifest = valibot.InferOutput<typeof MANIFEST>;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

const LOCKFILE = valibot.object({
    packages: valibot.record(
        valibot.string(),
        valibot.object({ version: valibot.optional(valibot.string()), link: valibot.optional(valibot.boolean()) }),
    ),
});

/** Where a workspace declares a package, and with what range. */
interface Declaration {
    workspace: string;
    range: string;
}

const root = await readManifest('.');
const lock = valibot.parse(LOCKFILE, await readJson('package-lock.json'));
const workspaces = ['.', ...root.workspaces];

const declarations = new Map<string, Declaration[]>();
for (const workspace of workspaces) {
    const manifest = workspace === '.' ? root : await readManifest(workspace);
    for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries(manifest[field])) {
            const list = declarations.get(name) ?? [];
            list.push({ workspace, range });
            declarations.set(name, list);
        }
    }
}

const problems: string[] = [];
for (const [name, declared] of declarations) {
    if (declared.length < 2) continue;
    const ranges = new Set(declared.map(({ range }) => range));
    const copies = new Set(declared.map(({ workspace }) => resolve(workspace, name).key));
    const where = declared.map(({ workspace, range }) => {
        const { key, version } = resolve(workspace, name);
        return `${workspace}: ${range} → ${version} at ${key}`;
    });
    const split = ranges.size > 1 || copies.size > 1;
    if (split && !SPLIT.has(name)) {
        const fix = ranges.size > 1 ? 'give every package.json the same range' : 'run `npm dedupe`';
        problems.push(`${name} differs between workspaces; ${fix}:\n  ${where.join('\n  ')}`);
    } else if (!split && SPLIT.has(name)) {
        problems.push(
            `${name} is one version everywhere again; take it out of SPLIT in scripts/check-dependency-versions.ts`,
        );
    }
}
for (const name of SPLIT.keys()) {
    if ((declarations.get(name)?.length ?? 0) < 2) {
        problems.push(`${name} is declared in fewer than two workspaces; take it out of SPLIT`);
    }
}

if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
}

/** The copy a workspace's code loads, found the way Node looks up node_modules from the workspace's directory. */
function resolve(workspace: string, name: string): { key: string; version: string } {
    const candidates = workspace === '.' ? [''] : [`${workspace}/`, ''];
    for (const prefix of candidates) {
        const key = `${prefix}node_modules/${name}`;
        const entry = lock.packages[key];
        if (entry !== undefined) {
            return { key, version: entry.link === true ? 'workspace' : (entry.version ?? 'unknown') };
        }
    }
    return { key: 'nowhere', version: 'not installed' };
}

async function readManifest(workspace: string): Promise<Manifest> {
    return valibot.parse(MANIFEST, await readJson(path.join(workspace, 'package.json')));
}

async function readJson(file: string): Promise<unknown> {
    return JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
}
