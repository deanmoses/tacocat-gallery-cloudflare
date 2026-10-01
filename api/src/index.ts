import { purgeSpentChallenges } from './auth/passkeys';
import { orm } from './db';
import { purgeUploadErrors } from './gallery/errors';
import { startUploadPipeline } from './gallery/pipeline';
import type { R2EventMessage } from './gallery/upload';
import { startBrowserRuns } from './ops/browser-runs';
import { createApp } from './routes/app';

export { UploadPipeline } from './gallery/pipeline';
export { Transcoder, VideoTranscoder } from './media/transcoder';

const app = createApp();

const NIGHTLY_CRON = '17 9 * * *';
const BROWSER_COLD_CRON = '23 5,11,19,22 * * *';
const BROWSER_WARM_CRON = '38 5,11,19,22 * * *';

export default {
    fetch: app.fetch,

    async queue(batch, env): Promise<void> {
        for (const message of batch.messages) {
            await startUploadPipeline(env, message.body);
            message.ack();
        }
    },

    async scheduled(controller, env): Promise<void> {
        switch (controller.cron) {
            case NIGHTLY_CRON: {
                await purgeUploadErrors(env);
                await purgeSpentChallenges(orm(env.DB));
                break;
            }
            case BROWSER_COLD_CRON: {
                await startBrowserRuns(env, 'cold');
                break;
            }
            case BROWSER_WARM_CRON: {
                await startBrowserRuns(env, 'warm');
                break;
            }
            default: {
                // A schedule this code does not name is a trigger left behind by an older release, and doing
                // nothing is the safe answer to it.
                console.warn({ event: 'unknown_cron', cron: controller.cron });
            }
        }
    },
} satisfies ExportedHandler<Env, R2EventMessage>;
