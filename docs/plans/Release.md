# The release

How a change reaches readers: every push to a pull request branch releases it to staging, and the merge to `main` releases production, through the same script and the same blue/green sequence. `scripts/release.sh` and Deploying in `README.md` are the reference; this page records the decisions behind them, what is left to do in the dashboard, and what the first runs must confirm.

## Decisions

- **Merge is the promote.** The AWS site deploys by a hand-started GitHub Action, because its tests were not trusted and staging had to be looked at first. Here the tests run against real bindings and the release checks the new version on the live hostname before any reader can reach it, so the manual gate buys nothing. The pull request's staging release is where a change gets looked at, and merging it is the decision to ship.
- **Versions and deployments are the blue/green.** `wrangler versions upload` is the idle stack, `wrangler versions deploy` at 100% is the switch, `wrangler rollback` is the switch back. What does not flip with them is the database schema, which is why migrations are additive by rule, and the container image, which only `wrangler deploy` publishes.
- **The check goes through the version-override header, not a Version URL.** Cloudflare generates no Version URL for a Worker that defines a Durable Object, which a Worker with a Container does. The alternative was moving the transcoder into a Worker of its own: a new workspace, a Durable Object deletion in both environments that no rollback could cross, and a container app to transfer, all to get a `workers.dev` hostname on which neither the custom domain, the zone's cache rules nor the passkey origin could be exercised. The header sends a request on the live hostname to a version deployed at 0%, which checks more and changes nothing.
- **Nothing splits traffic by percentage.** A split would serve one version's `index.html` with the other's hashed chunks. The new version goes from 0% to 100%.
- **Staging is one Worker, not a Preview per branch.** Worker Previews, shipped 2026-09-22, give each branch an isolated copy of the Worker with its own Durable Objects and containers, but a Preview's queue consumers and crons do not run: an upload to a Preview would be processed by whatever `main` has on staging. Two open pull requests fight over the one staging Worker, and the last push wins, which is fine for one person working mostly serially. Revisit when Previews reach the queue, or when that fight starts to hurt.
- **Staging's database is disposable.** A branch's migrations are applied to it on every push, so an amended migration or an abandoned branch leaves it with something production never gets. Restore to the bookmark the release printed, or empty it and seed it again.
- **Workers Builds, not a GitHub Actions deploy.** It keeps every API token out of GitHub, and with merge as the promote there is no approval step for Actions to host. Two independent connections, one per Worker, run on the same push to `main`; staging does not go first, because the tree being merged is the one its last push already released there.

Verified against Cloudflare's docs while designing this: a deployment holds at most two versions; `wrangler versions upload` never publishes a container image and refuses a Durable Object lifecycle change; no rollback crosses such a change; the override header is honored only for a version in the current deployment; `--containers-rollout` applies to `wrangler deploy` only; Workers Builds injects `WORKERS_CI_COMMIT_SHA` and `WORKERS_CI_BRANCH`, and its image has `curl`, `git` and Node.

## Left to do in the dashboard

The connections cannot be made from the repo, since the GitHub App is authorized as a person. The values are in the table under Deploying in `README.md`; the changes, in order:

1. On the staging Worker (`tacocat-gallery-cloudflare-staging`), Settings, Builds: set the deploy command to `../scripts/release.sh staging`, turn non-production branch builds on for every branch with the preview command `../scripts/release.sh staging`, and exclude `docs/**` and `**/*.md` in the build watch paths.
2. Open a pull request and watch its build under the staging Worker. Fix whatever the first run finds (below), on the same branch, until a push releases to staging cleanly.
3. On the production Worker (`tacocat-gallery-cloudflare`), Settings, Builds: connect the repository with production branch `main`, root directory `api`, the build command and variables from the table, deploy command `../scripts/release.sh production`, non-production branch builds off, and the same watch paths. The next merge to `main` releases production.

## What the first runs must confirm

The script has released to staging by hand once, end to end, from a machine with Docker: `versions upload` warned that container changes wait for a `deploy` and uploaded without building the image, every command took `--env ''` for staging, the seven-character tag and the full-sha message were accepted, and the check at 0% answered with the new version's id within a second of the deployment. Still to see:

- The same on Workers Builds, whose machine also has Docker.
- That the override header reaches the static assets of the 0% version as well as its Worker code. The app shell check passes on either build today; a release that changes the app is the first that can tell.
- Two pushes to two branches in quick succession: the loser's check must fail without switching traffic, since a deployment holds two versions and the second run's deployment evicts the first's 0% version.

## After that

- An alert when production starts failing after a release: a Cloudflare notification on the Worker's error rate, or a DebugBear alert, since it visits four times a day.
- `X-Robots-Tag: noindex` from the Worker and a `robots.txt` that allows crawling, as the AWS site sends; the app carries only the meta tag. Both environments, one change, a test each.
