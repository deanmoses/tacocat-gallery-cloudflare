import { beforeEach, vi } from 'vitest';

// No test reaches the network: code that fetches takes fetch as an argument, and a call to the global one fails, naming
// what it asked for. An image or video the browser loads is not a fetch and is left alone.
beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const request = new Request(input);
        throw new Error(`Unstubbed fetch of ${request.method} ${request.url}; pass the code a fetch that answers it`);
    });
});
