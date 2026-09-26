import { purgeSpentChallenges } from './auth/passkeys';
import { orm } from './db';
import { purgeUploadErrors } from './gallery/errors';
import { startUploadPipeline } from './gallery/pipeline';
import type { R2EventMessage } from './gallery/upload';
import { backupDatabase } from './ops/backup';
import { startBrowserRuns } from './ops/browser-runs';
import { probeIdleLatency } from './ops/probes';
import { createApp } from './routes/app';

export { UploadPipeline } from './gallery/pipeline';
export { Transcoder } from './media/transcoder';

const app = createApp();

const BACKUP_CRON = '17 9 * * *';
const BROWSER_COLD_CRON = '23 5,11,19,22 * * *';
const BROWSER_WARM_CRON = '38 5,11,19,22 * * *';
const PROBE_CRON = '23 0,1,3,7,15 * * *';

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
            case BACKUP_CRON: {
                await backupDatabase(env);
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
            case PROBE_CRON: {
                await probeIdleLatency(env);
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
