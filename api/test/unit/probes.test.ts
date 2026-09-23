import { describe, expect, it } from 'vitest';
import { workerReport } from '../../src/probes';

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
