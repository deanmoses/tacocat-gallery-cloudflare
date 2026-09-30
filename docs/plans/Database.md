# The database

This doc outlines the database strategy for the Cloudflare version of Tacocat photo gallery. The options:

- Continue with Cloudflare D1, their out of the box SQLite db
- Move to Postgres provided by a third party service

## Background

On AWS the gallery lives in one DynamoDB table. DynamoDB scaled without limit, but it was hard to evolve: it validates almost nothing, it constrains how data can be shaped, and changing it was intimidating enough that the schema barely changed in years. What rules there were lived in the Lambdas that wrote to it. Search was a separate service, Redis Labs, fed from the table by a stream.

When the Cloudflare prototype began we chose D1, Cloudflare's SQLite, for the following reasons:

- D1 is the default Cloudflare database.
- D1 is relational database whereas DynamoDB's a key-value store, which in my mind makes it easier to evolve.
- D1 puts read replicas around the world, which were to answer a reader's album request from a nearby region, well under 100 ms.
- D1 has SQLite's FTS5, so search could live in the same database and Redis and its sync could go.
- D1 runs inside the real Workers runtime, so tests run against the real thing.

We chose Drizzle as the ORM because it seemed to be the default choice. A side benefit was that it keeps the choice of DB reversible, since Drizzle drives both D1 and libSQL.

The port of the AWS back end then leaned on SQLite in ways DynamoDB never allowed. Every rule about a single row is a constraint in the database: 17 named `CHECK` constraints across the tables, beside `NOT NULL`, `UNIQUE` and foreign keys. Search is FTS5 over a view of the `item` table, kept in step by triggers. And because D1 has no interactive transactions, only batches of statements fixed before any runs, every write carries its conditions inside the statement, and when it changes nothing a second read says why.

## What changed

Some findings undercut parts of that choice:

### The read replicas never answer

Every album read logged on 2026-09-25, 49 of them, went to the primary in San Jose (`docs/Perf.md`). A replica wakes only when the same region reads again within seconds, and is inactive again 22 minutes later, while this site's normal reader arrives after an hour or more in which nobody has touched it. What a cold reader in Paris pays instead is the first contact between their Cloudflare location and D1, 355 to 652 ms, which behaves like a handshake of several round trips; a second read costs one round trip, 180 to 237 ms.

### Some table changes lose data on D1

We'd like to validate data as close to the database as possible. It turns out SQLite cannot add a `CHECK` to an existing table. It has to rebuild it: create the new table, copy every row across, drop the old one, and rename the new one into its place. SQLite's documented procedure turns foreign keys off first, and D1 does not allow that, because it runs each migration inside a transaction, where `PRAGMA foreign_keys = OFF` does nothing. So when the old table is dropped, SQLite deletes its rows first and fires the foreign-key actions: `item.thumbnail_id`, `upload.album_id` and `upload.target_id` are all `ON DELETE SET NULL`, so the drop clears every one of them.

The details, tested on 2026-09-27 against local D1 (`wrangler d1 migrations apply --local`) on a database holding an album with a thumbnail, an upload pointing at the album, and a photo that search found:

- drizzle-kit's generated rebuild fails outright: renaming the new table to `item` errors because the search view `item_indexed` names `item`. Dropping `item` also drops its four search triggers.
- With the view dropped first, the rebuild runs and clears every reference.
- `PRAGMA defer_foreign_keys = true`, which D1's migrations page recommends when a migration would violate foreign keys, does not help. It defers the checks, not the actions, and the references were cleared anyway.
- Copying the references into tables of their own before the drop and writing them back after the rename works. The thumbnail and the upload's links survived, the new `CHECK` refused a row that broke it, and search worked once the view, its triggers and both search indexes were rebuilt.

Only `SET NULL` and `CASCADE` foreign keys lose data this way. The references to `user` are `NO ACTION`, so dropping `user` would fail rather than lose anything; SQLite's documentation suggests `defer_foreign_keys` would let that rebuild succeed, which is untested. Nothing here has been repeated against a deployed database.

## The question

Should we stay on D1, or something else? Postgres would support:

- CHECK constraints without dropping the table
- transactions

We'd use Postgres, reached through Hyperdrive, Cloudflare's connection pooler for databases hosted elsewhere, on Neon or PlanetScale.

## Considerations

Each of these is as it stood in September 2026. Some are the kind of fact that changes; those are the ones to check first on coming back.

### Changing a table

SQLite changes some things in place and rebuilds the table for the rest:

| In place                                          | Only by rebuilding the table                  |
| ------------------------------------------------- | --------------------------------------------- |
| Add a column, nullable or with a constant default | Add, change or drop a `CHECK`                 |
| Rename a column or a table                        | Change a column's type, `NOT NULL` or default |
| Drop a column that nothing indexes or constrains  | Change a foreign key or its `ON DELETE`       |
| Add or drop an index, a view or a trigger         | Drop a column that is indexed or constrained  |

The change most likely to come up is a new kind of content: `item_media_type_check` lists `image` and `video`, so adding `audio` rebuilds `item`. So would loosening a caption rule, or changing what deleting a photo does to the albums that show it.

On D1, then, a rebuild is a hand-written migration: the view dropped, the references saved and restored, the view, triggers and search indexes recreated. Postgres adds and changes constraints in place, even on a large table without locking it, and a schema change that fails rolls back.

### Validating data

DynamoDB had no rules of its own; the Lambdas validated what they wrote, and nothing checked beneath them. Here the rules are checked twice: by `shared/`'s valibot schemas at the API, and by the constraints underneath. The constraints catch whatever goes around the API: an import or restore script, SQL run by hand, a new code path that forgets a rule.

There is no known bad data in DynamoDB. The copy from AWS translates shape rather than repairing damage: the video support of January 2026 left every media row `itemType: 'image'` with only videos carrying `mediaType`, and the copy finishes that migration. The one recorded repair on AWS, in `docs/Migrations.md` in `tacocat-gallery-sam`, fixed dimensions stored in the wrong orientation and tags that disagreed with their files, none unfixable; those rows disagreed with their files rather than with any rule a `CHECK` could state. `api/scripts/check-gallery.ts` runs every DynamoDB row through this Worker's rules; it had not been run against production.

So the constraints are insurance, not a response to damage. A rule also need not be a `CHECK` to be enforced: a `BEFORE INSERT` and `BEFORE UPDATE` trigger that calls `RAISE(ABORT, …)` enforces the same rule and can be changed without a rebuild, as the search triggers can. Drizzle cannot see a trigger, so the lint that holds the migrations to `schema.ts` would not cover it.

### Transactions

D1's one atomic unit is a batch of statements fixed before any runs, and Drizzle's `transaction()` sends a `BEGIN` that D1 refuses. The pattern that follows, conditions inside each statement and a second read to explain a write that changed nothing, is in `docs/plans/AwsPort.md`; six routes use it. It works and is tested, but it is more thought per write than `BEGIN … COMMIT`.

Postgres has interactive transactions. From a Worker far from the database each statement in one is a round trip, about 150 ms from Paris to Oregon, so they would have to stay short, or run in a Worker placed beside the database.

### Types

Timestamps are text held to one format by a constraint, and tags are JSON text held to an array by a constraint. Postgres's `timestamptz`, arrays, `jsonb` and enums would replace several of the 17 constraints with types.

### Latency

With replicas out of the picture, D1 and a single-region Postgres both send every read to one place. What differs is the cost of the first contact. D1's is measured: 355 to 652 ms from Paris. Hyperdrive exists to remove exactly that kind of handshake, by keeping pooled connections open next to the database, so Postgres behind Hyperdrive might answer a cold Paris read faster. That is a guess from how Hyperdrive works, not a measurement. Hyperdrive closes a pooled connection after 10 idle minutes, so a cold reader would also pay for it reconnecting to the database. No Postgres host offers San Jose; Oregon, the nearest, is about 20 ms further from the Bay Area.

`docs/Perf.md` has an open question that attacks the same gap from D1's side: running the album reads in a Worker placed beside D1, so the first contact is local.

### Search

Search is FTS5 over a view that splits letters from digits, with triggers keeping two indexes in step, and a compiler in `api/src/gallery/query.ts` that turns RediSearch's query syntax into FTS5 matches. Postgres has full-text search with ranking, `unaccent` for accents and trigram matching for typos, but the search would be rewritten, not ported.

### Simplicity and testing

On D1 the whole site is one platform, one bill and one binding, and every test, from the database tier to the end-to-end journeys, runs on real SQLite inside workerd with nothing to start. Postgres adds a vendor, with an account, a bill, a credential, a region and its own backups; Hyperdrive in between, with the connection string as a secret; the provider in OpenTofu; and a real Postgres for local development and every test run, in Docker locally and in CI, with a slower reset per test and a slower pre-commit hook. PGlite, Postgres compiled to WebAssembly, might soften the last of these; whether it runs under workerd was not checked. In Postgres's favour, Neon can branch a database per pull request, where staging is one shared database that a pull request's migrations can leave with something production never gets.

Moving would also mean rewriting the database layer: the schema, the search, the rows-read tests and the backup, roughly the size of the AWS port's database work.

### Cost

Hyperdrive is included in Workers Paid, with unlimited queries and no charge for pooling, caching or egress. The database itself is not. As priced on 2026-09-27:

|                  | Neon Free                | Neon Launch                          | PlanetScale PS-5                               |
| ---------------- | ------------------------ | ------------------------------------ | ---------------------------------------------- |
| Price            | $0, no card              | $0.106 per CU-hour, no minimum       | $5 a month, prorated to the millisecond        |
| Sleeps when idle | Always, after 5 min      | After 5 min, which can be turned off | Never                                          |
| US West          | Oregon (`aws-us-west-2`) | Oregon                               | Oregon (`us-west-2`)                           |
| Kept awake       | Cannot be                | About $230 a year at 0.25 CU         | $60 a year                                     |
| Billed by        | Neon                     | Neon                                 | PlanetScale, or through the Cloudflare account |

A database that sleeps suits this site badly: its reader normally arrives after an hour or more of quiet, so most reads would wake it. Kept awake for a decade, Postgres costs about $600 on PlanetScale or about $2,300 on Neon. D1 costs nothing beyond the Workers Paid plan the site pays for anyway. PlanetScale's $5 is from its pricing page; its docs point to a live price table instead.

## Perf experiment

How to know whether Postgres behind Hyperdrive would have answered a cold read faster or slower. A PlanetScale PS-5 in Oregon for a day or two, about $0.35; a throwaway Worker that reads one album through Hyperdrive and reports its timing as `x-d1` does, deployed rather than run under `wrangler dev`, which connects straight to the database and skips Hyperdrive; and `api/scripts/d1-round.ts`'s method from Paris and San Jose, a first read after 22 idle minutes, then repeats a second apart.

## The decision

We're going to stay with D1.

### Why stay

I don't like the costs of moving:

- another vendor
- another bill
- a local database for every test run

Also I feel we should use Cloudflare's default platform, which they'll likely invest a lot in improving. I expect D1 to get better.

### What we give up

- **Harder migrations**: hand-written rebuilds when changing the schema. However, tests can make this safe and routine. Migrations tested over data shaped like the real thing, a staging deploy on every pull request, and Time Travel to undo.
- **Messier SQL**: more careful writes that batches require, which are already written.
- **Perf?**: potentially a latency gain.
