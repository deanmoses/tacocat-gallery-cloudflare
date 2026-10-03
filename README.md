# tacocat-gallery-cloudflare

This repo is the code for the pix.tacocat.com photo gallery.

This is how to get it running on your localhost. What it is built on is [`docs/Architecture.md`](docs/Architecture.md), and the rest is indexed in [`docs/README.md`](docs/README.md).

## Prerequisites

- **Node 24**
- **The linting tools**: `brew install actionlint gitleaks shellcheck shfmt hadolint opentofu`. Without them the lint warns and skips those checks. The linting is super strict so you'll probably fail CI if you skip this.
- **Docker** (optional): to transcode video locally or to ship the transcoder's image. You can skip if you don't want run video uploads locally.
- **A Cloudflare Wrangler profile bound to this directory**, for anything that reaches the Cloudflare account, such as deploying, tailing logs or reading D1. Local development local tests don't need this.

```bash
npx wrangler auth create tacocat        # choose only the Tacocat account
npx wrangler auth activate tacocat .
```

## Getting started

### Install

```bash
fnm use  # or nvm use
npm install
```

### Give the Worker its secrets

`api/.dev.vars` (gitignored) holds the three `api/wrangler.jsonc` lists under `secrets.required`, without which `wrangler dev` refuses to start, plus `UPLOAD_MODE=local`, which makes uploads complete on your machine. Create it as:

```text
SESSION_SECRET=<the output of openssl rand -hex 32>
UPLOAD_MODE=local
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

then run `scripts/secrets.sh dev`, which fills the R2 pair in place with staging's signing key from OpenTofu's outputs. That needs `CLOUDFLARE_TERRAFORM_API_TOKEN` in the same file and the AWS CLI signed in to the gallery's account, as `docs/Infrastructure.md` describes. The tests need none of this file.

### Create the local database

```bash
npm run db:migrate:local --workspace api
```

### Run it

The Worker builds the web app and serves it with its own routes on <http://localhost:8787>:

```bash
npm run dev --workspace api
```

For hot reloading of the app, also run `npm run dev --workspace web`, which serves it on <http://localhost:5173> and passes the Worker's routes through to 8787. In VS Code, the task _Dev servers: Worker and web app_ (Terminal > Run Task) starts both side by side.

### The gallery starts empty

The gallery starts blank. You will need to log in to create content.

### Log in

Mint a one-time invite and open the link it prints to register a passkey:

```bash
api/scripts/invite.sh moses --local
```

The everyday commands are in `CLAUDE.md`.
