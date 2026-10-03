-- =====================================================================
-- Holdless · Tiger Data setup (Arteen)   Run in the service's SQL editor.
-- Checked on TimescaleDB 2.30.2.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;   -- already on in Tiger Cloud; harmless
SET timezone = 'America/Vancouver';

CREATE TABLE call_events (
  time           TIMESTAMPTZ NOT NULL,
  call_id        TEXT,
  company        TEXT,
  event          TEXT,      -- 'completed'
  hold_seconds   INT,
  outcome        TEXT,      -- 'won' | 'partial' | 'lost'
  saved_monthly  NUMERIC
) WITH (tsdb.hypertable, tsdb.segmentby = 'company');

-- 30 days of DEMO history (fake; say so in the pitch). Busier at lunch and on Mondays.
-- Hours are read in Vancouver time explicitly (AT TIME ZONE), so this is correct
-- even if the editor runs each statement in a fresh session.
INSERT INTO call_events (time, call_id, company, event, hold_seconds, outcome, saved_monthly)
SELECT ts,
       md5(random()::text),
       c,
       'completed',
       (120 + 900 * random() *
         CASE WHEN extract(hour FROM ts AT TIME ZONE 'America/Vancouver') BETWEEN 11 AND 14 THEN 1.8
              WHEN extract(dow  FROM ts AT TIME ZONE 'America/Vancouver') = 1 THEN 1.5
              ELSE 0.6 END)::int,
       CASE WHEN random() < 0.7 THEN 'won' ELSE 'lost' END,
       round((random() * 30)::numeric, 2)
FROM generate_series(now() - interval '30 days', now(), interval '20 minutes') AS ts
CROSS JOIN unnest(ARRAY['Rogers','Telus','Bell','Freedom','Koodo']) AS c
WHERE extract(hour FROM ts AT TIME ZONE 'America/Vancouver') BETWEEN 8 AND 20;

-- Average hold time per company per hour.
CREATE MATERIALIZED VIEW hold_by_hour
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket,
       company,
       avg(hold_seconds) AS avg_hold,
       count(*)          AS calls
FROM call_events
GROUP BY bucket, company;

CALL refresh_continuous_aggregate('hold_by_hour', NULL, NULL);

SELECT add_continuous_aggregate_policy('hold_by_hour',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');

-- Check: expect about 5,800 rows.
SELECT company, count(*) FROM call_events GROUP BY 1 ORDER BY 1;
