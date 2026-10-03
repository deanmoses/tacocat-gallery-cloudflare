import { describe, expect, it, vi } from 'vitest';
import { Guard, albumInScope, inParallel, inScope, parseScope, parseTarget, send } from '../../scripts/write-guard.ts';

const noPause = async (): Promise<void> => {
    /* the tests do not wait between attempts */
};

describe(parseScope, () => {
    it.each([
        { name: 'neither --all nor --only', args: ['version-ids.json'] },
        { name: 'both --all and --only', args: ['--all', '--only', '/2010/10-10/'] },
        { name: 'a media path for --only', args: ['--only', '/2010/10-10/eiffel'] },
        { name: '--only with nothing after it', args: ['--only'] },
    ])('refuses $name', ({ args }) => {
        expect(() => parseScope(args)).toThrow(/--all|--only/v);
    });

    it('takes every --only album, or --all', () => {
        expect(parseScope(['--only', '/2010/10-10/', '--only', '/1991/'])).toStrictEqual({
            all: false,
            albums: ['/2010/10-10/', '/1991/'],
        });
        expect(parseScope(['--all'])).toStrictEqual({ all: true });
    });
});

describe(inScope, () => {
    it("is true only inside the scope's albums", () => {
        const scope = parseScope(['--only', '/2010/10-10/']);

        expect(inScope(scope, '/2010/10-10/eiffel')).toBe(true);
        expect(inScope(scope, '/2010/10-11/eiffel')).toBe(false);
        expect(inScope(scope, '/2010/')).toBe(false);
    });
});

describe(albumInScope, () => {
    it('takes the year that holds a day in the scope, but not its other days', () => {
        const scope = parseScope(['--only', '/2010/10-10/']);

        expect(albumInScope(scope, '/2010/')).toBe(true);
        expect(albumInScope(scope, '/2010/10-10/')).toBe(true);
        expect(albumInScope(scope, '/2010/10-11/')).toBe(false);
        expect(albumInScope(scope, '/2011/')).toBe(false);
    });
});

describe(parseTarget, () => {
    it('refuses a run that names no target or one the script cannot write to', () => {
        expect(() => parseTarget(['--all'], ['staging', 'production'])).toThrow(/--to staging\|production/v);
        expect(() => parseTarget(['--to', 'local'], ['staging', 'production'])).toThrow(/--to/v);
        expect(parseTarget(['--to', 'production'], ['staging', 'production'])).toBe('production');
    });
});

describe(Guard, () => {
    it('stops the run when failures reach the limit', () => {
        const guard = new Guard(2);
        vi.spyOn(console, 'error').mockReturnValue(undefined);

        guard.fail('one');

        expect(guard.halted).toBeNull();

        guard.fail('two');

        expect(guard.halted).toBe('2 failures');
    });

    // Several items are under way at once, and one that fails after the run stopped is no count toward a limit
    it('says an item under way failed after the run stopped', () => {
        const guard = new Guard(1);
        const error = vi.spyOn(console, 'error').mockReturnValue(undefined);

        guard.fail('one');
        guard.fail('two');

        expect(error).toHaveBeenLastCalledWith('failure after stopping: two');
        expect(guard.halted).toBe('1 failures');
    });
});

describe(send, () => {
    it('sends again after a 503 and answers with what came next', async () => {
        const request = vi
            .fn<() => Promise<Response>>()
            .mockResolvedValueOnce(new Response('busy', { status: 503 }))
            .mockResolvedValueOnce(new Response('ok'));

        const response = await send(new Guard(5), 'copy', request, noPause);

        await expect(response?.text()).resolves.toBe('ok');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('answers a 404 without sending again, for the caller to judge', async () => {
        const request = vi.fn<() => Promise<Response>>().mockResolvedValue(new Response('', { status: 404 }));
        const guard = new Guard(5);

        expect((await send(guard, 'head', request, noPause))?.status).toBe(404);
        expect(request).toHaveBeenCalledExactlyOnceWith();
        expect(guard.halted).toBeNull();
    });

    it('stops the run on a 403, since every request after it would be refused too', async () => {
        const request = vi.fn<() => Promise<Response>>().mockResolvedValue(new Response('denied', { status: 403 }));
        const guard = new Guard(5);
        vi.spyOn(console, 'error').mockReturnValue(undefined);

        await expect(send(guard, 'copy', request, noPause)).resolves.toBeNull();
        expect(guard.halted).toBe('copy: 403 denied');
        expect(request).toHaveBeenCalledExactlyOnceWith();
    });

    it('stops the run when every attempt fails', async () => {
        const request = vi.fn<() => Promise<Response>>().mockRejectedValue(new Error('connection reset'));
        const guard = new Guard(5);
        vi.spyOn(console, 'error').mockReturnValue(undefined);

        await expect(send(guard, 'copy', request, noPause)).resolves.toBeNull();
        expect(request).toHaveBeenCalledTimes(3);
        expect(guard.halted).toBe('copy: connection reset after 3 attempts');
    });

    it('sends nothing once the run has stopped', async () => {
        const request = vi.fn<() => Promise<Response>>();
        const guard = new Guard(5);
        vi.spyOn(console, 'error').mockReturnValue(undefined);
        guard.halt('stopped');

        await expect(send(guard, 'copy', request, noPause)).resolves.toBeNull();
        expect(request).not.toHaveBeenCalled();
    });
});

describe(inParallel, () => {
    it('starts no item once the run has stopped', async () => {
        const guard = new Guard(5);
        const done: number[] = [];
        vi.spyOn(console, 'error').mockReturnValue(undefined);

        await inParallel(guard, [1, 2, 3, 4, 5], 1, async (item) => {
            done.push(item);
            if (item === 2) {
                guard.halt('stopped');
            }
            await Promise.resolve();
        });

        expect(done).toStrictEqual([1, 2]);
    });
});
