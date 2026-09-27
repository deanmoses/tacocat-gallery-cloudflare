import { d1Header } from '../db/timing';
import type { Written } from '../gallery/writes';
import { written } from '../http/bookmark';

/** The bookmark to read the write back with, and what it cost. */
export function wrote(session: D1DatabaseSession, write: Written, started: number): Response {
    return written(session, write.meta === null ? {} : { 'x-d1': d1Header(write.meta, performance.now() - started) });
}
