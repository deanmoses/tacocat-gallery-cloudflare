# Why the gallery moved from AWS to Cloudflare

The Tacocat photo gallery ran on AWS from December 2023 until 2026-10-02, when we migrated to Cloudflare.

The original impetus to investigate moving to Cloudflare was all about performance. With Cloudflare's edge native architecture, I thought we could get sub-100ms responses, globally: California, Louisiana or France, cold or warm.However, the measurements, in [PerfVsAws.md](PerfVsAws.md), ended with the two sites about the same.

But by then I had kinda fallen in love with Cloudflare for other reasons:

## Developer ergonomics

We find we much prefer Cloudflare's developer ergonomics. Things like:

- **Single repo development**. We replaced AWS's four repos (sveltekit, SPA hosting, SAM, auth) with this single monorepo. So much easier to manage! AIs can make coordinated changes. Vastly speeds up development. Now when I go back to AWS I hate it, it feels agonizingly clunky.
- **Localhost support**. Cloudflare's stack runs on localhost, meaning tests can run on the actual stuff that runs in prod. No more endlessly mocking out DynamoDB. I can run integration tests locally rather than in the cloud! I finally can log in and upload files on localhost! Much faster feedback loops, AI sessions can iterate on things super quick. Vastly speeds up development.
- **Simpler deploys**. Because we've improved testing (see below), I'm comfortable deploying to prod when merging a PR to main. No more manually clicking on Github Actions in four separate repos.

## Simplicity

The Cloudflare stack is simpler:

- **No subdomains**. This eliminated whole classes of domain management hassles and issues, and our CORS surface area is tiny.
- **Many less services**. No API Gateway, no CloudFront, no Cognito, no Redis.
- **Simpler storage**. We simplified media storage by making it truly immutable, meaning when we replace or rename an image, it's purely adding a new file under a new ID such that the only other things that change are in the database, which greatly simplified and speeded up renames and replaces.
- **No DuckDB analytics stack**. Our DuckDB stack for AWS existed because AWS logs were hard to query. CloudFront wrote TSV files into S3, CloudWatch Insights was clumsy, and you needed three providers to see one page load. DuckDB was the only place a question could be asked at all. Cloudflare's observability MCP and the query builder handle most of that.

## More robust

It feels like the Cloudflare stack can be more easily made robust than AWS. Examples:

- Because Cloudflare is a monorepo we're able to easily share code between the front end and back end, making whole classes of errors impossible by construction.
- Because it's easier to write and run integration tests, we are writing more tests, and I feel more comfortable doing things like enabling Dependabot.

## Feature improvements

We've found we can improve capabilities. For example:

- Switching to SQLite's built-in search allows for accent-insensitive search.
- Switching to SQLite and improved localhost support made it easier to add a users table and a photo re-ordering feature, things that I had been intimidated by on the DynamoDB based AWS system.
