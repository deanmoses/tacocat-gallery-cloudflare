/** How long each stage of some work took, in milliseconds, by name. */
export type Steps = Record<string, number>;

/** Runs `work`, recording how long it took in `steps` under `name`, whether it finished or threw. */
export async function timed<T>(steps: Steps, name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
        return await work();
    } finally {
        steps[name] = performance.now() - started;
    }
}

/**
 * Runs `work` as `timed` does, failing with an error that names the stage once it has run `limitMs`, so a call that
 * never answers ends the attempt with word of where it hung. The call itself runs on, since nothing can cancel it, until
 * the invocation ends.
 */
export async function bounded<T>(steps: Steps, name: string, limitMs: number, work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${name} did not finish within ${String(limitMs / 1000)} s`));
        }, limitMs);
    });
    try {
        return await timed(steps, name, async () => Promise.race([work(), late]));
    } finally {
        clearTimeout(timer);
    }
}
