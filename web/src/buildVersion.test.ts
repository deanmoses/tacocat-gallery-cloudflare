import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildVersion } from '../build-version';

let repo: string;

function write(file: string, content: string): void {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
}

describe(buildVersion, () => {
    beforeEach(() => {
        repo = mkdtempSync(path.join(tmpdir(), 'build-version-'));
        execFileSync('git', ['init', '--quiet'], { cwd: repo });
        write('.gitignore', 'web/build/\n');
        write('web/src/app.ts', 'app');
        write('web/src/app.test.ts', 'test');
        write('shared/src/album.ts', 'album');
        write('package-lock.json', '{}');
        write('.browserslistrc', 'iOS >= 15.6');
        write('tsconfig.base.json', '{}');
        write('api/src/index.ts', 'worker');
        write('docs/Perf.md', 'perf');
        execFileSync('git', ['add', '.'], { cwd: repo });
    });

    afterEach(() => {
        rmSync(repo, { recursive: true, force: true });
    });

    it('names the same tree the same every time', () => {
        expect(buildVersion(repo)).toBe(buildVersion(repo));
    });

    it.each([
        { name: 'the app', file: 'web/src/app.ts' },
        { name: 'shared code', file: 'shared/src/album.ts' },
        { name: 'a dependency', file: 'package-lock.json' },
        { name: 'the browser floor', file: '.browserslistrc' },
        { name: 'compiler settings', file: 'tsconfig.base.json' },
        { name: 'a new file of the app, not yet added', file: 'web/src/new.ts' },
    ])('changes with $name', ({ file }) => {
        const before = buildVersion(repo);

        write(file, 'changed');

        expect(buildVersion(repo)).not.toBe(before);
    });

    it('changes when a file of the app is deleted', () => {
        const before = buildVersion(repo);

        rmSync(path.join(repo, 'web/src/app.ts'));

        expect(buildVersion(repo)).not.toBe(before);
    });

    it.each([
        { name: 'the Worker', file: 'api/src/index.ts' },
        { name: 'the docs', file: 'docs/Perf.md' },
        { name: 'a test of the app', file: 'web/src/app.test.ts' },
        { name: 'the build itself', file: 'web/build/_app/version.json' },
    ])('holds through a change to $name', ({ file }) => {
        const before = buildVersion(repo);

        write(file, 'changed');

        expect(buildVersion(repo)).toBe(before);
    });
});
