/**
 * Where a D1 query ran and how long it took, as a header Globalping can record without reading the body. A missing
 * value prints as `undefined`, as it always has, so rows already in probe_result stay comparable.
 */
export function d1Header(meta: D1Meta, roundTripMs: number, rowsRead: number = meta.rows_read): string {
    return [
        `rows=${rowsRead}`,
        `region=${String(meta.served_by_region)}`,
        `colo=${String(meta.served_by_colo)}`,
        `primary=${String(meta.served_by_primary)}`,
        `sql=${String(meta.timings?.sql_duration_ms.toFixed(1))}`,
        `rtt=${round(roundTripMs)}`,
    ].join(' ');
}

/** One decimal place. */
export function round(value: number): number {
    return Math.round(value * 10) / 10;
}
