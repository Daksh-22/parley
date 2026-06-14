-- Parley analytics — example questions the warehouse answers.
--
-- These run against either target (table names are identical):
--   DuckDB     : tables live in the default schema  (just run them)
--   Snowflake  : tables live in PARLEY.ANALYTICS    (USE SCHEMA first)
--
-- DuckDB:    python query.py     (from data-pipeline/, no DuckDB CLI needed)
-- Snowflake: run any block below in a worksheet after USE SCHEMA PARLEY.ANALYTICS

-- 1) Daily AI token spend and cost driver, by provider/model.
--    The product thesis is "memory is the product" — this is what it costs.
SELECT
  d.date,
  c.provider,
  c.model,
  COUNT(*)                         AS calls,
  SUM(c.total_tokens)              AS tokens,
  ROUND(AVG(c.latency_ms), 1)      AS avg_latency_ms,
  SUM(CASE WHEN c.cached THEN 1 ELSE 0 END) AS cache_hits
FROM fact_ai_call c
JOIN dim_date d ON d.date_key = c.date_key
GROUP BY d.date, c.provider, c.model
ORDER BY d.date DESC, tokens DESC;

-- 2) Answer quality — the feedback flywheel. Thumbs up/down rate per kind.
SELECT
  kind,
  COUNT(*)                                                    AS answers,
  SUM(CASE WHEN is_thumbs_up THEN 1 ELSE 0 END)               AS up,
  SUM(CASE WHEN is_thumbs_down THEN 1 ELSE 0 END)             AS down,
  ROUND(100.0 * SUM(CASE WHEN is_thumbs_up THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN is_thumbs_up OR is_thumbs_down THEN 1 ELSE 0 END), 0), 1)
                                                              AS pct_positive
FROM fact_ai_call
WHERE ok
GROUP BY kind
ORDER BY answers DESC;

-- 3) Most active rooms in the last 30 days (channels vs DMs).
SELECT
  r.name,
  r.is_dm,
  r.ai_enabled,
  SUM(a.message_count)         AS messages,
  SUM(a.ai_answer_count)       AS ai_answers,
  MAX(a.distinct_sender_count) AS peak_daily_speakers
FROM fact_room_activity_daily a
JOIN dim_room r ON r.room_id = a.room_id
JOIN dim_date d ON d.date_key = a.date_key
WHERE d.date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY r.name, r.is_dm, r.ai_enabled
ORDER BY messages DESC
LIMIT 20;

-- 4) Retrieval health — how many sources each answer grounded on, and how
--    that tracks with positive feedback (does grounding correlate with quality?).
SELECT
  source_count,
  COUNT(*)                                        AS answers,
  ROUND(AVG(retrieval_hits), 1)                   AS avg_hits,
  ROUND(100.0 * AVG(CASE WHEN is_thumbs_up THEN 1.0 ELSE 0 END), 1) AS pct_up
FROM fact_ai_call
WHERE kind IN ('room-ask', 'global-ask', 'catchup')
GROUP BY source_count
ORDER BY source_count;

-- 5) New-user signup cohort by month.
--    Derived straight from the signup date — not joined to dim_date, so users
--    who signed up on a day with no messages/AI calls are still counted.
SELECT
  YEAR(account_created_at)  AS year,
  MONTH(account_created_at) AS month,
  COUNT(*)                  AS signups
FROM dim_user
WHERE account_created_at IS NOT NULL
GROUP BY YEAR(account_created_at), MONTH(account_created_at)
ORDER BY year, month;
