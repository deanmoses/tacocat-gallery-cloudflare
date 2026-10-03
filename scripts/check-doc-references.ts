// Fails when a doc names a file, directory or npm script the repo does not have. The docs' readers are coding agents,
// which take a path in a doc at its word and act on it, so a reference left behind by a rename or a deletion is a bug.
//
// It reads every tracked markdown file but the plans, which are frozen once built and are expected to rot. In each, it
// checks the targets of relative links, the words of inline code and of bash code blocks that look like paths, and
// every `npm run`, `npm test` or `npm start` against the scripts of the package its --workspace names. A path is
// checked when it resolves from the doc's own directory, when it starts with ./ or ../, or when its first segment is
// one of the repo's top-level entries; a bare file name of a source type is checked against every file's name. A path
// git ignores, such as api/.dev.vars, counts as present, since a doc rightly names files a machine makes. Words
// holding a placeholder or a glob are skipped.
//
// Usage: node scripts/check-doc-references.ts

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import * as valibot from 'valibot';

const ROOT = path.resolve(import.meta.dirname, '..');

/** File types whose bare names, such as `write-guard.ts`, are worth checking against every file in the repo. */
const SOURCE_EXTENSIONS = new Set(['ts', 'js', 'mjs', 'sh', 'md', 'svelte', 'json', 'jsonc', 'yml', 'yaml', 'tf']);
const SHELL_FENCES = new Set(['bash', 'sh', 'shell', 'zsh']);
/** A word holding any of these is a placeholder, a glob, an assignment or a pipe, not a path. */
const NOT_A_PATH = ['<', '>', '*', '{', '}', '…', '$', '=', '|', '...', '://'];
const LEADING_PUNCTUATION = new Set(['(', '"', "'", '[']);
const TRAILING_PUNCTUATION = new Set([')', '"', "'", ',', ';', ':', '.', ']']);

const MANIFEST = valibot.object({ scripts: valibot.optional(valibot.record(valibot.string(), valibot.string()), {}) });

function git(...args: string[]): string[] {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

function withoutSlash(repoPath: string): string {
    return repoPath.endsWith('/') ? repoPath.slice(0, -1) : repoPath;
}

// Tracked files and new ones not yet added, less those deleted in the working tree, as a full run of the lint sees.
const deleted = new Set(git('ls-files', '--deleted'));
const files = new Set(
    git('ls-files', '--cached', '--others', '--exclude-standard').filter((file) => !deleted.has(file)),
);
const directories = new Set<string>();
for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) {
        directories.add(dir);
    }
}
const topLevel = new Set([...files].map((file) => file.split('/', 1)[0] ?? ''));
const basenames = new Set([...files].map((file) => path.posix.basename(file)));

function exists(repoPath: string): boolean {
    const normalized = withoutSlash(path.posix.normalize(repoPath));
    return normalized === '.' || files.has(normalized) || directories.has(normalized);
}

function isSourceFileName(name: string): boolean {
    const extension = path.posix.extname(name).slice(1);
    return !name.startsWith('.') && name.length > extension.length + 1 && SOURCE_EXTENSIONS.has(extension);
}

interface Reference {
    doc: string;
    line: number;
    target: string;
}

const missingPaths: Reference[] = [];
const problems: string[] = [];

/** A link resolves from its doc alone; a path in code may be written from the doc's directory or the repo's root. */
function checkPath(ref: Reference, kind: 'link' | 'code'): void {
    const fromDoc = path.posix.join(path.posix.dirname(ref.doc), ref.target);
    if (exists(fromDoc)) {
        return;
    }
    if (kind === 'link' || ref.target.startsWith('./') || ref.target.startsWith('../')) {
        missingPaths.push({ ...ref, target: fromDoc });
        return;
    }
    if (exists(ref.target)) {
        return;
    }
    const named = ref.target.includes('/')
        ? topLevel.has(ref.target.split('/', 1)[0] ?? '')
        : isSourceFileName(ref.target) && !basenames.has(ref.target);
    if (named) {
        missingPaths.push(ref);
    }
}

/** The word without the punctuation prose wraps it in. */
function trimmed(word: string): string {
    let start = 0;
    let end = word.length;
    while (start < end && LEADING_PUNCTUATION.has(word.charAt(start))) {
        start++;
    }
    while (end > start && TRAILING_PUNCTUATION.has(word.charAt(end - 1))) {
        end--;
    }
    return word.slice(start, end);
}

/** The path a word names, or nothing when the word is not a path the check can judge. */
function pathIn(word: string): string | undefined {
    const bare = trimmed(word);
    const mapped = bare.startsWith('$lib/') ? `web/src/lib/${bare.slice('$lib/'.length)}` : bare;
    if (mapped === '' || ['/', '~', '@', '-'].some((start) => mapped.startsWith(start))) {
        return undefined;
    }
    if (NOT_A_PATH.some((marker) => mapped.includes(marker))) {
        return undefined;
    }
    return mapped.includes('/') || isSourceFileName(mapped) ? mapped : undefined;
}

function checkWords(ref: Omit<Reference, 'target'>, text: string): void {
    for (const word of text.split(/\s+/v)) {
        const target = pathIn(word);
        if (target !== undefined) {
            checkPath({ ...ref, target }, 'code');
        }
    }
}

const manifests = new Map<string, Set<string> | undefined>();
function scriptsOf(workspace: string): Set<string> | undefined {
    if (!manifests.has(workspace)) {
        const file = workspace === '.' ? 'package.json' : `${workspace}/package.json`;
        const scripts = files.has(file)
            ? new Set(
                  Object.keys(valibot.parse(MANIFEST, JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))).scripts),
              )
            : undefined;
        manifests.set(workspace, scripts);
    }
    return manifests.get(workspace);
}

/** The npm script a command runs and the workspace it runs in, or nothing when the command runs none. */
function npmScript(words: readonly string[]): { script: string; workspace: string } | undefined {
    const npm = words.indexOf('npm');
    const verb = words[npm + 1];
    if (npm === -1 || verb === undefined) {
        return undefined;
    }
    const script =
        verb === 'run'
            ? words.slice(npm + 2).find((word) => !word.startsWith('-'))
            : ['test', 'start'].find((name) => name === verb);
    if (script === undefined || ['<', '>', '`'].some((marker) => script.includes(marker))) {
        return undefined;
    }
    let workspace = '.';
    for (let index = npm + 1; index < words.length; index++) {
        const word = words[index] ?? '';
        if (word === '--workspace' || word === '-w') {
            workspace = words[index + 1] ?? '.';
        } else if (word.startsWith('--workspace=')) {
            workspace = word.slice('--workspace='.length);
        }
    }
    return { script, workspace };
}

function checkNpm(ref: Omit<Reference, 'target'>, command: string): void {
    const segments = ['#', '&', ';', '|'].reduce<string[]>(
        (parts, separator) => parts.flatMap((part) => part.split(separator)),
        [command],
    );
    for (const segment of segments) {
        const run = npmScript(segment.trim().split(/\s+/v));
        if (run === undefined) {
            continue;
        }
        const scripts = scriptsOf(run.workspace);
        if (scripts === undefined) {
            problems.push(`${ref.doc}:${String(ref.line)}: npm workspace ${run.workspace} has no package.json`);
        } else if (!scripts.has(run.script)) {
            const where = run.workspace === '.' ? 'the root package.json' : `${run.workspace}/package.json`;
            problems.push(`${ref.doc}:${String(ref.line)}: npm script ${run.script} is not in ${where}`);
        }
    }
}

const markdown = new MarkdownIt();

/** The doc's path when a link's target is one, without its anchor; a link with a scheme is a URL. */
function linkPath(href: string): string | undefined {
    const target = markdown.normalizeLinkText(href).split('#', 1)[0] ?? '';
    return target === '' || target.includes(':') ? undefined : target;
}

const docs = [...files].filter((file) => file.endsWith('.md') && !file.startsWith('docs/plans/')).toSorted();
for (const doc of docs) {
    for (const token of markdown.parse(readFileSync(path.join(ROOT, doc), 'utf8'), {})) {
        // A block's map is its first and last line, counted from 0. Paragraphs and list items are never wrapped here,
        // so an inline token's first line is the line its code and links are on.
        const first = token.map?.[0] ?? 0;
        if (token.type === 'fence' && SHELL_FENCES.has(token.info.trim().split(/\s+/v, 1)[0] ?? '')) {
            for (const [index, text] of token.content.split('\n').entries()) {
                const ref = { doc, line: first + 2 + index };
                const comment = text.indexOf(' #');
                const command = comment === -1 ? text : text.slice(0, comment);
                checkNpm(ref, command);
                checkWords(ref, command);
            }
        } else if (token.type === 'inline') {
            const ref = { doc, line: first + 1 };
            for (const child of token.children ?? []) {
                if (child.type === 'code_inline') {
                    checkNpm(ref, child.content);
                    checkWords(ref, child.content);
                } else if (child.type === 'link_open') {
                    const target = linkPath(String(child.attrGet('href') ?? ''));
                    if (target !== undefined) {
                        checkPath({ ...ref, target }, 'link');
                    }
                }
            }
        }
    }
}

/**
 * The paths git ignores, which are ones a machine makes, such as api/.dev.vars or web/build. Each is asked about as a
 * directory too, since a rule such as `playwright-report/` matches only a path ending in a slash.
 */
function gitIgnored(paths: readonly string[]): Set<string> {
    if (paths.length === 0) {
        return new Set();
    }
    try {
        const output = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
            cwd: ROOT,
            encoding: 'utf8',
            input: paths.flatMap((repoPath) => [repoPath, `${withoutSlash(repoPath)}/`]).join('\n'),
        });
        return new Set(output.split('\n').filter(Boolean).map(withoutSlash));
    } catch (error) {
        // check-ignore exits 1 when it ignores none of them.
        if (error instanceof Error && 'status' in error && error.status === 1) {
            return new Set();
        }
        throw error;
    }
}

const ignored = gitIgnored(missingPaths.map((ref) => ref.target));
for (const ref of missingPaths) {
    if (!ignored.has(withoutSlash(ref.target))) {
        problems.push(`${ref.doc}:${String(ref.line)}: ${ref.target} does not exist`);
    }
}

if (problems.length > 0) {
    console.error(problems.toSorted((left, right) => left.localeCompare(right, 'en', { numeric: true })).join('\n'));
    process.exitCode = 1;
}
