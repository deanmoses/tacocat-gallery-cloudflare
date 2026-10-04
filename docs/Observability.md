# Observability

Watching the deployed site: whether it is up, what it logged, what broke and what it costs. Configuring these is [Monitoring and alerting](Infrastructure.md#monitoring-and-alerting) in `Infrastructure.md`.

## Is production okay?

```bash
curl -s https://pix.tacocat.com/api/health
```

answers 200 once D1 and both buckets respond, with the running version's id, its tag, which is the commit it was built from with `-dirty` when the tree had uncommitted changes, and the newest migration the database has, by name. To watch requests as they happen, from the repo root:

```bash
npm run logs:production --workspace api
```

`npm run logs --workspace api` watches staging. Both are `wrangler tail`, which shows only what happens while it runs.

## Workers Logs

Workers Logs keeps a week of every request's invocation log, with the user agent, IP, colo, country, round trip, status and CPU and wall time, beside the Worker's own structured lines; the `cookie` header is redacted. Read them in the dashboard's [Observability](https://dash.cloudflare.com/ed3ca575118099486baeb129959697c8/workers-and-pages/observability) page, whose query builder filters, groups and charts on any field, or through the observability MCP, which is how a Claude session reads them. Each environment is its own Worker, `production` or `staging`, so filter on the service first.

The Worker's own lines carry an `event` field, which is what to filter on:

- `server_exception` is a request that threw; its stack points at the TypeScript source, since source maps are uploaded.
- `album_read` and `derived_image` are the reads and the images, with timings.
- The `upload_*` events follow an upload through the pipeline; those at error level, such as `upload_failed`, `upload_rejected`, `upload_refused` and `upload_unstarted`, are an upload that did not finish.
- `video_transcoded` is the transcoder's work.
- `admin_logged_in` and the `passkey_*` events are logins.

Two gaps: a question over months cannot be answered from it, and the app's own files, `index.html` and the JS chunks, are answered by the asset router without reaching the Worker, so they appear only in the zone's analytics, though every album view still reaches the Worker for its JSON and images. Logpush, free at this volume, could keep the zone's HTTP request logs and the Worker's trace events in R2 if a long question comes up.

## Workers Issues

[Issues](https://developers.cloudflare.com/workers/observability/issues/) groups each Worker's uncaught exceptions, failed invocations, 5xx responses and `console.error` lines into issues, one per kind of failure. It is in beta.

An issue posts to Discord the first time that failure happens, so a broken release posts once per kind of failure rather than once per request. In production it posts again when it comes back after a quiet day; on staging it does not. Each Worker's Issues tab, [production](https://dash.cloudflare.com/ed3ca575118099486baeb129959697c8/workers/services/view/production/production/issues?status=active) and [staging](https://dash.cloudflare.com/ed3ca575118099486baeb129959697c8/workers/services/view/staging/production/issues?status=active), counts every occurrence, with each one's request, logs and stack.

## Grafana uptime checks

Use the Grafana MCP server; people start at the [Synthetic Monitoring app](https://tacocorp.grafana.net/a/grafana-synthetic-monitoring-app/home).

Datasources are `grafanacloud-prom` for the probe metrics (`probe_success`, `probe_duration_seconds`, `probe_http_duration_seconds` by phase, `probe_ssl_earliest_cert_expiry`) and `grafanacloud-logs` for the probes' log lines. Three things have misled readings of them before:

- **The scrape interval is not the check interval.** Metrics are scraped about every 2 minutes but a check runs every 10, so one measurement is republished several times; `count_over_time` overstates how many runs there were. A real run is a change in value.
- **`config_version` changes on every edit of a check**, and two versions coexist briefly after a save, so aggregate across it and prefer `avg` to `sum`.
- **The alert reads Loki, not Prometheus.** It counts the probes' failed-check log lines, so if log ingestion broke, the alert would go quiet rather than fire.

A single request cannot see what a page load does with connection hints, HTTP/3 or connection reuse; that is what DebugBear's runs in [`Perf.md`](Perf.md) are for.

## Spending

The Billable Usage page, under Billing, breaks the period's spend down by product, and Spending in `CLAUDE.md` says what reaches it.
