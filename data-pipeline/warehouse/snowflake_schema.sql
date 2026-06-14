-- Parley analytics warehouse — Snowflake DDL.
--
-- Star schema over the Parley memory layer. The loader (warehouse/load.py)
-- runs this file before loading, so re-running is safe (IF NOT EXISTS / OR
-- REPLACE where appropriate). Column names match the gold Parquet produced by
-- spark/transform.py one-for-one.
--
-- Apply manually if you prefer:  snowsql -f warehouse/snowflake_schema.sql

-- --- Warehouse, database, schema -------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS PARLEY_WH
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60          -- suspend after 1 min idle to keep cost near zero
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;

CREATE DATABASE IF NOT EXISTS PARLEY;
CREATE SCHEMA IF NOT EXISTS PARLEY.ANALYTICS;

USE WAREHOUSE PARLEY_WH;
USE SCHEMA PARLEY.ANALYTICS;

-- --- Dimensions ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS DIM_DATE (
  DATE_KEY     INTEGER     NOT NULL PRIMARY KEY,  -- yyyymmdd
  DATE         DATE        NOT NULL,
  YEAR         INTEGER     NOT NULL,
  QUARTER      INTEGER     NOT NULL,
  MONTH        INTEGER     NOT NULL,
  MONTH_NAME   STRING,
  DAY          INTEGER     NOT NULL,
  DAY_OF_WEEK  INTEGER     NOT NULL,             -- 1=Sunday .. 7=Saturday
  DAY_NAME     STRING,
  IS_WEEKEND   BOOLEAN
);

CREATE TABLE IF NOT EXISTS DIM_USER (
  USER_ID            STRING NOT NULL PRIMARY KEY,  -- Mongo ObjectId as hex
  USERNAME           STRING,
  DISPLAY_NAME       STRING,
  ACCOUNT_CREATED_AT TIMESTAMP_NTZ,
  LAST_SEEN_AT       TIMESTAMP_NTZ
);

CREATE TABLE IF NOT EXISTS DIM_ROOM (
  ROOM_ID         STRING NOT NULL PRIMARY KEY,
  NAME            STRING,
  SLUG            STRING,
  IS_DM           BOOLEAN,
  AI_ENABLED      BOOLEAN,
  CREATOR_USER_ID STRING,                          -- null for system-seeded rooms
  ROOM_CREATED_AT TIMESTAMP_NTZ
);

-- --- Facts -----------------------------------------------------------------
-- Grain: one chat message.
CREATE TABLE IF NOT EXISTS FACT_MESSAGE (
  MESSAGE_ID      STRING NOT NULL PRIMARY KEY,
  ROOM_ID         STRING,
  SENDER_ID       STRING,
  DATE_KEY        INTEGER,
  CREATED_AT      TIMESTAMP_NTZ,
  KIND            STRING,                          -- 'user' | 'ai'
  IS_AI_ANSWER    BOOLEAN,
  BODY_LENGTH     INTEGER,
  WORD_COUNT      INTEGER,
  HAS_CITATIONS   BOOLEAN,
  CITATION_COUNT  INTEGER,
  HAS_AI_QUESTION BOOLEAN
  -- BODY STRING                                   -- only if INCLUDE_MESSAGE_TEXT=true
);

-- Grain: one AI call (the token-spend / quality fact).
CREATE TABLE IF NOT EXISTS FACT_AI_CALL (
  STREAM_ID       STRING NOT NULL PRIMARY KEY,
  USER_ID         STRING,
  DATE_KEY        INTEGER,
  CREATED_AT      TIMESTAMP_NTZ,
  KIND            STRING,        -- room-ask | global-ask | catchup | decisions | rerank
  PROVIDER        STRING,
  MODEL           STRING,
  TOKENS_IN       INTEGER,
  TOKENS_OUT      INTEGER,
  TOTAL_TOKENS    INTEGER,
  LATENCY_MS      INTEGER,
  CACHED          BOOLEAN,
  OK              BOOLEAN,
  ERROR_CODE      STRING,
  VERDICT         STRING,        -- 'up' | 'down' | null  (the feedback flywheel)
  RETRIEVAL_HITS  INTEGER,
  SOURCE_COUNT    INTEGER,
  IS_THUMBS_UP    BOOLEAN,
  IS_THUMBS_DOWN  BOOLEAN
  -- QUESTION STRING, ANSWER STRING                -- only if INCLUDE_MESSAGE_TEXT=true
);

-- Grain: one room x one day (pre-aggregated rollup for dashboards).
CREATE TABLE IF NOT EXISTS FACT_ROOM_ACTIVITY_DAILY (
  ROOM_ID               STRING,
  DATE_KEY              INTEGER,
  MESSAGE_COUNT         INTEGER,
  AI_ANSWER_COUNT       INTEGER,
  DISTINCT_SENDER_COUNT INTEGER,
  TOTAL_WORDS           INTEGER
);
