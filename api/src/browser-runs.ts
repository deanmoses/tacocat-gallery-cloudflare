import * as valibot from 'valibot';

const DEBUGBEAR_API = 'https://www.debugbear.com/api/v1';
// The project whose pages each run the album journey on one site from one location; which pages it holds is managed
// in DebugBear.
const DEBUGBEAR_PROJECT = '107830';

const PROJECT = valibot.object({ pages: valibot.array(valibot.object({ id: valibot.string() })) });

export type BrowserRunKind = 'cold' | 'warm';

/**
 * Starts a DebugBear test of every page in the project, titled with the kind of run. DebugBear finishes them on its
 * own machines, so nothing here waits for results.
 */
export async function startBrowserRuns(env: Env, kind: BrowserRunKind): Promise<void> {
    const project = valibot.parse(PROJECT, await (await debugbear(env, `/projects/${DEBUGBEAR_PROJECT}`)).json());
    await Promise.all(
        project.pages.map(async (page) => debugbear(env, `/page/${page.id}/analyze`, { buildTitle: kind })),
    );
    console.info({ event: 'browser_runs_started', kind, pages: project.pages.length });
}

async function debugbear(env: Env, route: string, body?: object): Promise<Response> {
    const response = await fetch(`${DEBUGBEAR_API}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'x-api-key': env.DEBUGBEAR_API_KEY,
            // DebugBear refuses some clients' default user agents.
            'user-agent': 'tacocat-gallery-cloudflare',
            ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
        throw new Error(`DebugBear ${route}: ${String(response.status)} ${(await response.text()).slice(0, 300)}`);
    }
    return response;
}
