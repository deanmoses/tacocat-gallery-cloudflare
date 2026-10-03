# Infrastructure

The resources the gallery runs on are declared as code in the repo; do NOT make changes by clicking in web UIs:

- **[OpenTofu (`infra/`)](#opentofu)**: databases, buckets, DNS, AWS backups
- **[Wrangler (`api/wrangler.jsonc`)](#wrangler)**: Cloudflare Worker
- **[GitHub (`scripts/github-setup.sh`)](#github)**: repo settings
- **[Manual steps](#manual-steps)**: that cannot be configured via code

## OpenTofu

`infra/` holds the config for everything outside the Worker: the zone and its settings once, the backup token, the AWS bucket and key the backups go to, and each environment's database, buckets, the CORS rule and event notification uploads need, queues and signing token through the `environment` module, one instance per entry in `local.environments`, whose key is the environment's name and the prefix of everything in it. Its `d1_database_ids` output is what `api/wrangler.jsonc` binds.

```bash
scripts/tofu.sh plan
```

`scripts/tofu.sh` hands its arguments to `tofu` along with the account API token named `CLOUDFLARE_TERRAFORM_API_TOKEN` in `api/.dev.vars`, kept out of `CLOUDFLARE_API_TOKEN` because Wrangler would pick that up over the `tacocat` profile; it needs Account API Tokens Write as well as its resource permissions, since it makes the signing tokens. The AWS provider takes the AWS CLI's credentials, whichever profile or session `aws configure export-credentials` resolves, so the CLI has to be signed in to the gallery's AWS account.

**Where the Cloudflare provider falls short:** it cannot set the zone's per-category AI crawler policies or the bot preference sync, which were set through the API and the dashboard; R2 custom domains and event notifications cannot be imported; importing a D1 database needs `ignore_changes` on its location hint; and when Cloudflare's API fails for one setting, every `plan` hangs on it, and `-target` on the resources that matter is the way through.

### The state

The state holds the tokens' values and lives in the `opentofu-state` R2 bucket through the S3 backend, so no machine holds the only copy and a second session or a runner can plan against it; the script derives the backend's S3 key from the same token, the way any API token is one ([Secrets](#secrets)). R2 has no bucket versioning and the nightly backup leaves this bucket out, since its token would then read the tokens' values, so the bucket is the one copy. Before a `-replace` or a destroy, keep one:

```bash
scripts/tofu.sh state pull > infra/before.tfstate
```

which the directory's `.gitignore` covers. A lost state is rebuilt by importing the resources and rotating the tokens.

A run locks the state with a lock object the backend creates only if none exists, which R2 honours, so a run started while another is under way is refused rather than writing over it. A run killed mid-way leaves its lock behind; remove it with the id the refusal prints:

```bash
scripts/tofu.sh force-unlock <id>
```

## Wrangler

`api/wrangler.jsonc` declares the Worker and everything it binds, for both environments: staging is the config's top level and production is its `env.production` block, each with its own Worker name, routes, vars and bindings. What it declares:

- **The static assets**, the web app's build, served ahead of the Worker except for the paths in `run_worker_first`.
- **The bindings** to what OpenTofu made: the D1 database by the id `scripts/tofu.sh output d1_database_ids` prints, the two R2 buckets by name, the upload queue as producer and consumer with its dead-letter queue, and the Images binding local development uses.
- **What Wrangler itself creates:** the Workflow, `UploadPipeline`; the Durable Object class, `Transcoder`, whose `migrations` array is the record of its lifecycle; and the container application behind it, with its image, `standard-4` instance type, instance limit and rollout settings.
- **The triggers**, the nightly cron and the custom domain, and the `vars`, the site's origin, the bucket names the Worker signs URLs for, and the upload and image modes.
- **The secrets it requires**, `secrets.required`, which Wrangler refuses to run without ([Secrets](#secrets)).

Every release applies it: a version upload carries the bindings and vars, `wrangler triggers deploy` the crons and domain, and `api/scripts/ship-transcoder.ts` the container's image and settings. A Durable Object lifecycle change, a new Workflow and a queue consumer's settings go out only through the plain `wrangler deploy`, as Ship what a release can't in [`Releasing.md`](Releasing.md) says. After editing the file, run `npm run types --workspace api`, which regenerates the Worker's binding types; the type check fails until it has.

## Manual steps

These cannot be configured via code:

- **The Cloudflare account**, on the Workers Paid plan, with R2 enabled once in the dashboard.
- **The `opentofu-state` bucket**, since a config cannot create the bucket its own state is read from ([The state](#the-state)). From `api/`, then `scripts/tofu.sh init`:

    ```bash
    npx wrangler r2 bucket create opentofu-state
    ```

- **The account API token OpenTofu runs as**, `CLOUDFLARE_TERRAFORM_API_TOKEN` in `api/.dev.vars`, made in the dashboard with Account API Tokens Write and its resource permissions ([OpenTofu](#opentofu)).
- **The deploy token and Dependabot's**, made in the dashboard and stored as the repository's secrets (The deploy tokens in [`Releasing.md`](Releasing.md)).
- **Zone settings the provider cannot set**, the per-category AI crawler policies and the bot preference sync, set through the API and the dashboard ([OpenTofu](#opentofu)).
- **Image Transformations left off on both zones**, since enabling them would open `/cdn-cgi/image/` URLs to anyone ([`Media.md`](Media.md)).
- **The nameservers at GoDaddy**, pointed at the zone's ([The zone](#the-zone)).
- **The AWS CLI signed in** to the gallery's AWS account, for the backup bucket's provider ([OpenTofu](#opentofu)).

## Secrets

The Worker reaches its database, buckets and queue through bindings, which need no credentials. The one thing a binding cannot do is sign a URL, so each Worker holds an S3 key to presign the browser's upload, the transcoder's reads and writes, and Image Transformations' reads, and an S3 key on R2 is an API token: the access key is the token's id and the secret the SHA-256 of its value. The tokens are defined in `infra/`, as roles would be: each environment's signing token may read and write its `originals` and `derived` buckets and nothing else, since the browser's upload is a signed PUT of the original itself and a token is scoped to whole buckets, and the backup token may read production's `originals` bucket and nothing else. `scripts/secrets.sh` moves each token's credentials from OpenTofu's outputs to where they are used, the Worker (`staging`, `production`), the repository (`backup`) or `api/.dev.vars` (`dev`), so no value passes through a person. The values sit in OpenTofu's state, which is the cost of defining them as code. Rotate a signing token in `Operations.md` has the steps.

## Standing up an environment

How both environments were made, and how a third would be, in order. The Worker's first deploy has to be the plain one, since `scripts/release.sh` releases onto a Worker that already serves a version and already has its container application.

1. Add the environment to `local.environments` in `infra/main.tf` and apply; `scripts/tofu.sh output d1_database_ids` prints the database id for `api/wrangler.jsonc`, which also needs the environment's block, its Worker name, hostname and resource names.
2. Put a fresh `SESSION_SECRET_<ENVIRONMENT>` in `api/.dev.vars` (`openssl rand -hex 32`), then `scripts/secrets.sh <environment>`, which puts the Worker's three secrets on it in one upload: the R2 pair from the signing token the apply just made, and that session secret. Wrangler creates the Worker as a draft to hold them.
3. Deploy, `npm run deploy:production --workspace api` (or `deploy` for staging). Docker has to be up: the deploy builds and ships the transcoder's image. If the hostname is attached to another Worker, Wrangler asks whether to move it, and the answer moves it.
4. Apply the migrations, `npm run db:migrate:production --workspace api` (or `db:migrate`), then `api/scripts/invite.sh <user> --env <environment>` for a passkey.

## The zone

`infra/tacocat.tf` declares the `tacocat.com` zone, whose nameservers `scripts/tofu.sh output tacocat_name_servers` prints and GoDaddy points at. Its records are DNS-only, with two exceptions: `pix.tacocat.com` and `staging-pix.tacocat.com` are the Workers' custom domains and so have no record in the config, and the AWS gallery's production names `api.pix`, `auth.pix` and `img.pix` stay, with their certificate validation records, until the AWS gallery is retired (deanmoses/tacocat-gallery-sam#179). The Zone diff workflow in the Actions tab, `scripts/zone-diff.sh`, compares every record on two nameservers; it must see authoritative answers, which a home network that intercepts DNS never gives it, so it runs from GitHub.

## Github

This repo's settings are applied by `scripts/github-setup.sh` through the GitHub API, so they can be read and re-applied from here: branch protection, the deploy Environments, secret scanning with push protection, Dependabot alerts and security updates, merge options and the pull request labels `CONTRIBUTING.md` lists. Run it once after creating the repository and again whenever it changes. The one secret in GitHub is the deploy token, with a second for Dependabot (The deploy tokens in `Releasing.md`).

Three things keep the supply chain honest. Dependabot (`.github/dependabot.yml`) proposes npm, GitHub Actions, Docker and OpenTofu updates weekly, grouped, after a seven-day cooldown so a version pulled within days of publication never arrives. Every GitHub Action is pinned to a full commit id with its version as a comment; the lint fails on a tag, and Dependabot moves the ids. Secrets are caught three times: gitleaks on the staged files at commit, gitleaks over the whole history in CI, and GitHub's push protection at the remote.

Each CI job starts from `.github/actions/setup`, which installs Node and the packages with the npm and Playwright caches, and the lint job adds `scripts/install-lint-tools.sh`, which gives the runner the system tools the lint needs, each pinned to the version Homebrew has locally and verified against its release checksum; when `brew upgrade` moves one, move it there too. GitHub gives a public repo unlimited Actions minutes, so a parallel job costs nothing but the setup it repeats.
