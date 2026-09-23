/** Where a D1 query ran and how long it took. */
export interface D1Timing {
    servedByRegion: string | undefined;
    servedByColo: string | undefined;
    servedByPrimary: boolean | undefined;
    sqlMs: number | undefined;
    rowsRead: number;
}

/** Where a D1 query ran and how long it took, for the JSON body. */
export function pickMeta(meta: D1Meta): D1Timing {
    return {
        servedByRegion: meta.served_by_region,
        servedByColo: meta.served_by_colo,
        servedByPrimary: meta.served_by_primary,
        sqlMs: meta.timings?.sql_duration_ms,
        rowsRead: meta.rows_read,
    };
}

/**
 * The same as a header, which Globalping can record without reading the body. A missing value prints as
 * `undefined`, as it always has, so rows already in probe_result stay comparable.
 */
export function d1Header(meta: D1Meta, roundTripMs: number): string {
    return [
        `region=${String(meta.served_by_region)}`,
        `colo=${String(meta.served_by_colo)}`,
        `primary=${String(meta.served_by_primary)}`,
        `sql=${String(meta.timings?.sql_duration_ms.toFixed(1))}`,
        `rtt=${String(round(roundTripMs))}`,
    ].join(' ');
}

/** One decimal place. */
export function round(value: number): number {
    return Math.round(value * 10) / 10;
}
