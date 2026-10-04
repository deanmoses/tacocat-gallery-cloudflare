# Releasing

How a change reaches readers, what to do when the pipeline isn't enough, and how to undo a release. The runbooks come first; [How it works](#how-it-works) has the mechanism.

## At a glance

- A push to a pull request branch releases it to `staging-pix.tacocat.com`; a merge to `main` releases production and staging both, so staging is back on what production runs between pull requests. Both run `.github/workflows/deploy.yml`, which runs `scripts/release.sh`. A push that changes only markdown deploys nothing.
- What a hostname is running: Is production okay? in [`Observability.md`](Observability.md). The repository's Environments panel lists what is on each environment, every pull request shows when its commits reached them, and the Actions tab has each release's log.
- The undo is the `wrangler rollback` command the release prints at its end, safe as long as the migrations were additive.

## Runbooks

### Release by hand

The same release the workflow runs, from your machine:

```bash
scripts/release.sh staging
```

```bash
scripts/release.sh production
```

Or start the workflow from the Actions tab (Run workflow, choosing the environment), which releases the chosen branch's head again, say after a failure that was not the code's.

### Undo a release

Run the `wrangler rollback` command the release printed. If the release's run is gone, from `api/`:

```bash
npx wrangler rollback --env production
```

A rollback cannot cross a Durable Object class change, and it leaves the database as it is: the migrations are additive by rule, so the previous version still runs on them. A failed check already left the previous version serving, with the run red, and needs no rollback; the one case that does is a release whose migrations broke the previous version, which the release finishes anyway, since the new version was written for the new schema.

### Ship what a release can't

Three things go out only through the plain `wrangler deploy`:

- A Durable Object class change, the `migrations` array in `api/wrangler.jsonc`, which Cloudflare accepts only through `wrangler deploy`, on its own, and which no rollback can cross.
- A new Workflow: a version release binds to it by name but does not create it, and until the plain deploy has, every `create` on the binding fails, which a queue consumer then retries.
- A queue consumer's settings, such as its batch size, which a version release leaves as they were.

```bash
npm run deploy --workspace api -- --containers-rollout=none
```

```bash
npm run deploy:production --workspace api -- --containers-rollout=none
```

The flag leaves the container to the release, since a plain deploy otherwise rolls out an image of its own, which the next release replaces. Docker has to be up either way, since the deploy builds the transcoder's image. Adding `routes` to `api/wrangler.jsonc` switches off `workers.dev` unless `workers_dev` is set.

### Check the transcoder's image

```bash
cd api && npx wrangler containers info
```

It shows the previous image until a rollout finishes, a minute or so after the release.

## How it works

### The pipeline

Staging does not go first: branch protection needs the branch up to date with `main`, so the tree being merged is the one its last push already released there, and for the same reason the workflow does not wait for CI. Releases to one Worker run one at a time, in the order pushed. Each run is a job against a GitHub Environment, `staging` or `production`, which `scripts/github-setup.sh` creates; production accepts a deploy from `main` only.

### What a release does

The release is blue/green on Workers' versions and deployments:

1. Ship the transcoder's container first, when a file under `api/transcoder/` or `api/wrangler.jsonc` differs from the commit it last shipped from ([The transcoder's image](#the-transcoders-image)).
2. Build the web app and upload a version, which serves no traffic.
3. Note the database's Time Travel bookmark and apply the migrations, which are additive by rule so the version still serving keeps working, and check that it does.
4. Put the new version in the deployment at 0% and check it on the live hostname through the `Cloudflare-Workers-Version-Overrides` header: the health route answers with the version id it expects and a migration no older than the tree's newest, the root album's JSON parses, the app shell is the app, and `/_app/version.json` is the build just uploaded.
5. Switch it to 100%, check again, and roll back if that fails.
6. Apply the config's triggers, the crons and the custom domain, with `wrangler triggers deploy`, since a version release leaves those as they were.

Traffic is never split between versions, since a split would serve one version's `index.html` with the other's files. A failed check leaves the previous version serving and the run red. If the migrations break the previous version, the release goes on to the new one, which was written for the new schema, but the run ends red and nothing rolls back to the broken version. The release keeps the app's file names when the app has not changed, by naming the build from a hash of its inputs, so a release that touches only the Worker leaves every cached chunk valid.

### The transcoder's image

The container is not part of a Worker version, so the release ships it before anything else changes. `api/scripts/ship-transcoder.ts` writes the commit into each rollout's description and reads it back from the application's latest rollout, so a release that fails after this step, leaving the container ahead of the Worker, is not mistaken for no change; a rollout that names no commit in the checkout, such as a plain `wrangler deploy`'s or a dirty tree's, ships again. It builds the image, tagged with the release's tag, pushes it, and sets it by digest on the container application with the `containers` block's instance type, instance limit and grace period, then starts a rollout, the same two requests `wrangler deploy` makes. That needs Docker, which the CI runner has, and Workers Containers Write, which both tokens have. It never touches the Worker's versions, so an upload running at the time keeps its version. Nothing checks the container or rolls it back with the Worker, so, like a migration, an image has to work with both the version serving and the one being released; the rollout leaves an instance still encoding on the old image for up to its grace period anyway.

### The deploy tokens

The workflow's Wrangler authenticates with the repository secret `CLOUDFLARE_API_TOKEN`, the only credential in GitHub: an account API token made in the Cloudflare dashboard (Manage account, Account API tokens, Create Token) from the Edit Cloudflare Workers template with D1 Edit and Containers Edit added, scoped to this account, and stored with `gh secret set CLOUDFLARE_API_TOKEN`. A Dependabot pull request's run reads only Dependabot's secrets, so a second token, stored with `gh secret set CLOUDFLARE_API_TOKEN --app dependabot`, lets a dependency bump reach staging before its merge releases it to production. It runs code from packages no one has reviewed, so it has only what the release uses: Workers Editor at the account scope (Workers Scripts Write before Cloudflare replaced it), D1 Write, Workers Containers Write and Account Settings Read. The account id is in `api/wrangler.jsonc`, so the token is all the workflow needs.
