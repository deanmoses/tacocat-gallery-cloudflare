import { describe, expect, it } from 'vitest';
import { ftsQuery } from '../../src/gallery/query';
import { pathAfter } from '../../src/http/paths';
import { PROBE_SEQUENCE, workerReport } from '../../src/ops/probes';

describe('PROBE_SEQUENCE', () => {
    it('searches with terms where the search route reads them', () => {
        const searches = PROBE_SEQUENCE.filter(({ path }) => path.startsWith('/api/search')).map(({ path }) =>
            ftsQuery(pathAfter(new URL(path, 'https://probe.test'), '/api/search/')),
        );

        expect(searches).toStrictEqual([{ query: expect.anything() }]);
    });
});

describe(workerReport, () => {
    it('reads where the Worker and D1 ran, and how long each took', () => {
        const report = workerReport({
            'x-worker-colo': 'CDG',
            'server-timing': 'worker;dur=12.5',
            'x-d1': 'rows=21 region=WEUR colo=FRA primary=false sql=0.3 rtt=20.1',
        });

        expect(report).toStrictEqual({
            workerColo: 'CDG',
            workerMs: 12.5,
            d1Region: 'WEUR',
            d1Colo: 'FRA',
            d1Primary: 'false',
            d1RttMs: 20.1,
        });
    });

    it('takes the first of a repeated header', () => {
        expect(workerReport({ 'x-worker-colo': ['SJC', 'LAX'] }).workerColo).toBe('SJC');
    });

    it('has nothing to report from a response that did not reach the Worker', () => {
        expect(workerReport({})).toStrictEqual({
            workerColo: undefined,
            workerMs: null,
            d1Region: undefined,
            d1Colo: undefined,
            d1Primary: undefined,
            d1RttMs: null,
        });
    });
});
