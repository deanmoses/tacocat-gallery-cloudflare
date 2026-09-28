import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Everything in the repo a change to which can change the app's build, as git pathspecs from the repo's root. Tests
 * are left out, since they never reach the build.
 */
const BUILD_INPUTS = [
    'web',
    'shared',
    'package-lock.json',
    '.browserslistrc',
    'tsconfig.base.json',
    ':(exclude,glob)**/*.test.ts',
];

/**
 * A name for the app's build that changes only when what goes into it does. SvelteKit writes the name into a chunk
 * nearly every other chunk imports, so its default, the build's time, renamed every file under `_app/immutable` on
 * every release, and each colo and browser fetched the whole app again after one that changed nothing in it. The name
 * still has to change whenever a chunk does: a browser holding the old app that finds its next chunk gone reloads the
 * page only if `version.json` names a different build. Uncommitted files count, so a build by hand names what it built.
 */
export function buildVersion(repo: string, inputs: readonly string[] = BUILD_INPUTS): string {
    const listed = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate', '--', ...inputs],
        { cwd: repo, encoding: 'utf8' },
    );
    const files = listed
        .split('\0')
        .filter((file) => file !== '' && existsSync(path.join(repo, file)))
        .toSorted();
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(`${file}\0`);
        hash.update(readFileSync(path.join(repo, file)));
        hash.update('\0');
    }
    return hash.digest('hex').slice(0, 16);
}
