import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Steps, bounded } from '../../src/util/stages';

describe(bounded, () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fails with the stage named once a call has run its limit, and records how long it ran', async () => {
        const steps: Steps = {};
        const hung = bounded(steps, 'thumbnail', 60_000, async () => Promise.withResolvers<never>().promise);
        const settled = Promise.allSettled([hung]);
        await vi.advanceTimersByTimeAsync(60_000);
        const [outcome] = await settled;

        expect(outcome).toMatchObject({
            status: 'rejected',
            reason: new Error('thumbnail did not finish within 60 s'),
        });
        expect(steps).toHaveProperty('thumbnail');
    });

    it('answers with what the call answers, and leaves no timer behind', async () => {
        const steps: Steps = {};

        await expect(bounded(steps, 'read', 60_000, async () => 'bytes')).resolves.toBe('bytes');
        expect(vi.getTimerCount()).toBe(0);
        expect(steps).toHaveProperty('read');
    });
});
