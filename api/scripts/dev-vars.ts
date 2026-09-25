import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The Worker's secrets as api/.dev.vars holds them, read for a script's own use and never printed. */
export async function devVars(): Promise<Record<string, string>> {
    const lines = (await readFile(path.join(API_DIR, '.dev.vars'), 'utf8')).split('\n');
    return Object.fromEntries(
        lines
            .filter((line) => line.includes('='))
            .map((line) => {
                const at = line.indexOf('=');
                return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
            }),
    );
}
