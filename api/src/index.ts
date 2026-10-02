import { purgeSpentChallenges } from './auth/passkeys';
import { orm } from './db';
import { purgeUploadErrors } from './gallery/errors';
import { reportUnstartedUpload, startUploadPipeline } from './gallery/pipeline';
import type { R2EventMessage } from './gallery/upload';
import { createApp } from './routes/app';

export { UploadPipeline } from './gallery/pipeline';
export { Transcoder } from './media/transcoder';

const app = createApp();

const NIGHTLY_CRON = '17 9 * * *';

export default {
    fetch: app.fetch,

    async queue(batch, env): Promise<void> {
        // The upload queue's dead-letter queue is named for it with this suffix in every environment.
        const deadLetters = batch.queue.endsWith('-dlq');
        for (const message of batch.messages) {
            await (deadLetters ? reportUnstartedUpload(env, message.body) : startUploadPipeline(env, message.body));
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
            default: {
                // A schedule this code does not name is a trigger left behind by an older release, and doing
                // nothing is the safe answer to it.
                console.warn({ event: 'unknown_cron', cron: controller.cron });
            }
        }
    },
} satisfies ExportedHandler<Env, R2EventMessage>;
