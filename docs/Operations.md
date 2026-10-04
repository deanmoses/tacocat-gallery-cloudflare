# Operations

Running the deployed system: what's live, and how to put data and access right. Shipping and rolling back are in [`Releasing.md`](Releasing.md); changing the infrastructure is in [`Infrastructure.md`](Infrastructure.md). Anything here that reaches the Cloudflare account needs the Wrangler profile from Prerequisites in `README.md`, and the scripts need `api/.dev.vars`.

## At a glance

- **Two Workers**, `production` on `pix.tacocat.com` and `staging` on `staging-pix.tacocat.com`, each with its own database, buckets, queues, secrets and admin passkeys, every resource named `<environment>-<role>`. Both are public and both send noindex.
- **Staging is the default.** It is `api/wrangler.jsonc`'s top level, so a Wrangler command without `--env production` touches staging, and the scripts in `api/package.json` come in pairs: `deploy` and `deploy:production`, `db:migrate` and `db:migrate:production`, `logs` and `logs:production`.
- **Three undo levers:** `wrangler rollback` for a release, D1 Time Travel to a bookmark for the database, and the versioned off-site bucket for the originals.
- **Where to look:** `/api/health` and the logs ([`Observability.md`](Observability.md)), and the Actions tab and Environments panel on GitHub.

## Environments

What differs between the environments beyond the bindings is the `vars`: the site's origin, which is the only origin besides local development that may create or use a passkey, and the S3 names of the buckets the Worker signs URLs for, `DERIVED_BUCKET` and `ORIGINALS_BUCKET`. `IMAGE_MODE` is the same in both, `transformations`, and differs only under `npm run dev --workspace api` and the tests. Each environment's one cron is the nightly cleanup. `wrangler dev` and the tests run the top level too, entirely locally, so their bucket and queue names are staging's. Standing up a third environment is in [`Infrastructure.md`](Infrastructure.md).

### Fix staging's database

Staging holds test albums that never reach production; upload whatever a test needs. Its database is disposable: every push to a pull request branch applies that branch's migrations to it, so a migration amended after a push, or a branch abandoned, leaves it with something production never gets. Either:

1. Restore it to the bookmark the release printed ([Restore the database to a bookmark](#restore-the-database-to-a-bookmark), without `--env production`), or
2. Empty it and migrate it again. From `api/`,

    ```bash
    npx wrangler d1 execute DB --remote --command "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
    ```

    lists what to drop: drop the views first, then every table, `d1_migrations` included; the FTS5 tables take their shadow tables with them and the triggers go with `item`. Then apply the migrations with `npm run db:migrate --workspace api` and mint an invite for a passkey with `api/scripts/invite.sh <user> --env staging`, since `passkey` went with the rest. It starts with no albums; upload what a test needs.

## Restore the database to a bookmark

D1's Time Travel is the in-place undo. Before anything risky, note the current bookmark, from `api/`:

```bash
npx wrangler d1 time-travel info DB --env production
```

and restore to it with:

```bash
npx wrangler d1 time-travel restore DB --env production --bookmark=<bookmark>
```

The release prints the bookmark it noted before applying migrations. Time Travel restores `item` and `item_fts` consistently, but a restore to a timestamp can land minutes early, so restore to a bookmark.

## Backup and restore

The Backup workflow (`.github/workflows/backup.yml`) runs nightly: it exports the `item`, `passkey` and `d1_migrations` tables with `wrangler d1 export --table`, since D1 refuses to export a database holding an FTS5 table whole, and rclone mirrors them and `production-originals` into the `tacocat-gallery-cloudflare-backup` S3 bucket in the gallery's AWS account. The bucket is versioned and keeps every previous version 35 days, and the workflow's key cannot delete a version, so a bad night, or a leaked key, is undone with `rclone copy --s3-version-at <time>`. A full run over the whole gallery takes about half an hour, and a night with little new about a minute. The bucket and its key are the `backup` module in `infra/`, and `scripts/secrets.sh backup` sets the workflow's secrets.

To restore:

1. **The originals:** rclone copy the tree back into the bucket, with editing paused. Every object written there raises the upload event, and each starts a Workflow instance that finds no pending upload and ends, so an upload made during a restore of the whole gallery waits behind them.
2. **The database:** migrate an empty one to the migration the export's `d1_migrations.sql` ends with, then, from `api/`:

    ```bash
    npx wrangler d1 execute DB --remote --env production --file item.sql
    npx wrangler d1 execute DB --remote --env production --file passkey.sql
    ```

    The triggers rebuild the search index as the rows go in. An export is restorable only with the migrations it names, so one from before a reset of the migrations needs them from the git history.

The database restore has been rehearsed on staging with a few rows, not on production with the full gallery: rehearse on staging first, and expect the full one to take longer than anyone has timed.

## Admin login

```bash
api/scripts/invite.sh <user> --env production
```

prints a one-time invite link for that environment's Worker; `--env staging` for staging, `--local` for `npm run dev --workspace api`. The name has to be in the `user` table, which no screen edits: a migration seeds it (`api/migrations/*_seed_users.sql`), so adding a user is another migration, and every environment gets the same users. To check the whole flow without a browser, run `node api/scripts/passkey-selftest.ts "$(api/scripts/invite.sh moses --local)"` against `npm run dev --workspace api`.

**To log everyone out**, or end a stolen session, rotate `SESSION_SECRET`: a session cannot be revoked on its own. Removing an admin means deleting their passkeys and rotating it. The secret is `SESSION_SECRET_<ENVIRONMENT>` in `api/.dev.vars`; replace it with `openssl rand -hex 32` and run `scripts/secrets.sh <environment>`, which uploads it with the R2 pair.

## Rotate a signing token

The Worker's R2 credentials are an API token defined in `infra/`, so rotating one is replacing the resource and placing the new value:

```bash
scripts/tofu.sh apply -replace=<the token's address>
scripts/secrets.sh production
```

`scripts/secrets.sh` takes `staging`, `production`, `backup` for the Backup workflow's repository secrets, or `dev` for `api/.dev.vars`. Secrets in [`Infrastructure.md`](Infrastructure.md) has the tokens and what each may reach; Local development in [`Development.md`](Development.md) has what `api/.dev.vars` holds.

## Scripts

The one-off and recovery scripts in `api/scripts/` each say how to run them in the comment at their top; `api/scripts/README.md` is the index.
