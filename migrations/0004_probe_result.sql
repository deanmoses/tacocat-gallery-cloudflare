-- Latency seen by Globalping probes that the Worker's own cron schedules, to measure reads after idle gaps.
CREATE TABLE probe_result (
    id INTEGER PRIMARY KEY,
    run_at TEXT NOT NULL,
    idle_hours REAL,
    location TEXT NOT NULL,
    seq INTEGER NOT NULL,
    path TEXT NOT NULL,
    probe_city TEXT,
    probe_network TEXT,
    status INTEGER,
    total_ms INTEGER,
    dns_ms INTEGER,
    tcp_ms INTEGER,
    tls_ms INTEGER,
    first_byte_ms INTEGER,
    worker_colo TEXT,
    worker_ms REAL,
    d1_region TEXT,
    d1_colo TEXT,
    d1_primary TEXT,
    d1_rtt_ms REAL,
    measurement_id TEXT,
    error TEXT
);

CREATE INDEX probe_result_run_at ON probe_result (run_at);
