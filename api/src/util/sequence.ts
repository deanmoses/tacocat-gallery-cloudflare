/**
 * Runs `step` on each item in order, starting the next only when the last has finished: for work that must not
 * overlap, like uploads that each hold a whole file in memory, or D1 batches that should not queue up.
 */
export async function inSequence<T extends object, R>(
    items: readonly T[],
    step: (item: T) => Promise<R>,
): Promise<R[]> {
    const [first, ...rest] = items;
    if (first === undefined) {
        return [];
    }
    const result = await step(first);
    return [result, ...(await inSequence(rest, step))];
}
