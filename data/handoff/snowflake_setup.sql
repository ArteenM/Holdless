-- =====================================================================
-- Holdless · Snowflake setup (Arteen)   Run top to bottom in a Snowsight SQL worksheet.
-- =====================================================================

CREATE WAREHOUSE IF NOT EXISTS HOLDLESS_WH WAREHOUSE_SIZE='XSMALL' AUTO_SUSPEND=60 AUTO_RESUME=TRUE;
CREATE DATABASE IF NOT EXISTS HOLDLESS;
CREATE SCHEMA IF NOT EXISTS HOLDLESS.CORE;
USE WAREHOUSE HOLDLESS_WH;
USE SCHEMA HOLDLESS.CORE;

-- WARNING: CREATE OR REPLACE wipes the table. Don't re-run these two after Tony's data is loaded.
CREATE OR REPLACE TABLE PLAN_PRICES (
  PROVIDER       STRING,
  PLAN_TYPE      STRING,        -- 'internet' or 'mobile' (lowercase, exactly)
  PLAN_NAME      STRING,
  SPEED_MBPS     NUMBER,        -- internet only, else empty
  DATA_GB        NUMBER,        -- mobile only, else empty
  MONTHLY_PRICE  NUMBER(10,2),
  PROMO_PRICE    NUMBER(10,2),  -- empty if no promo
  PROMO_MONTHS   NUMBER,
  REGION         STRING,        -- 'BC'
  SOURCE_URL     STRING,
  CHECKED_AT     DATE           -- YYYY-MM-DD
);

CREATE OR REPLACE TABLE DEAL_INTEL (
  COMPANY           STRING,
  PLAN_TYPE         STRING,
  ASKED_FOR         STRING,
  ARGUMENT_USED     STRING,       -- 'competitor price' | 'loyalty' | 'cancel threat' | 'retention dept'
  RESULT            STRING,       -- 'won' | 'partial' | 'lost'
  DISCOUNT_MONTHLY  NUMBER(10,2),
  DURATION_MONTHS   NUMBER,
  SOURCE_URL        STRING,
  REPORTED_ON       DATE
);

-- ---------------------------------------------------------------------
-- TEST ROWS, so the queries can be built before Tony's CSVs arrive.
-- Prices are made up. Every row has SOURCE_URL = 'test-row'.
-- Enough rows to check Rogers, Telus and Bell on internet (500 Mbps) and mobile (50 GB).
-- ---------------------------------------------------------------------
INSERT INTO PLAN_PRICES VALUES
  ('Rogers',  'internet', 'Ignite 500',          500, NULL, 105.00,  85.00, 12, 'BC', 'test-row', '2026-10-03'),
  ('Telus',   'internet', 'PureFibre 500',       500, NULL,  95.00,  60.00, 24, 'BC', 'test-row', '2026-10-03'),
  ('Bell',    'internet', 'Fibe 500',            500, NULL,  95.00,  75.00, 12, 'BC', 'test-row', '2026-10-03'),
  ('Shaw',    'internet', 'Fibre+ 500',          500, NULL, 100.00,  70.00, 12, 'BC', 'test-row', '2026-10-03'),
  ('Freedom', 'internet', 'Home Internet 500',   500, NULL,  50.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Novus',   'internet', 'Novus 500',           500, NULL,  65.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Rogers',  'mobile',   'Essentials 50 GB',   NULL,  50,  85.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Telus',   'mobile',   '50 GB 5G+',          NULL,  50,  85.00,  75.00, 24, 'BC', 'test-row', '2026-10-03'),
  ('Bell',    'mobile',   'Essential 50 GB',    NULL,  50,  85.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Fido',    'mobile',   '50 GB',              NULL,  50,  55.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Koodo',   'mobile',   '50 GB',              NULL,  50,  50.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03'),
  ('Freedom', 'mobile',   '50 GB 5G+',          NULL,  60,  45.00,   NULL, NULL, 'BC', 'test-row', '2026-10-03');

INSERT INTO DEAL_INTEL VALUES
  ('Rogers', 'internet', 'lower bill',      'competitor price', 'won',     25.00, 12, 'test-row', '2026-09-01'),
  ('Rogers', 'internet', 'lower bill',      'cancel threat',    'won',     30.00, 24, 'test-row', '2026-09-08'),
  ('Rogers', 'internet', 'lower bill',      'loyalty',          'partial', 10.00,  6, 'test-row', '2026-09-15'),
  ('Rogers', 'mobile',   'lower bill',      'retention dept',   'won',     20.00, 12, 'test-row', '2026-09-20'),
  ('Rogers', 'mobile',   'lower bill',      'loyalty',          'lost',     NULL, NULL, 'test-row', '2026-09-22'),
  ('Telus',  'internet', 'lower bill',      'competitor price', 'won',     35.00, 24, 'test-row', '2026-09-03'),
  ('Telus',  'mobile',   'lower bill',      'cancel threat',    'won',     15.00, 12, 'test-row', '2026-09-10'),
  ('Telus',  'internet', 'waive late fee',  'loyalty',          'partial',  5.00,  1, 'test-row', '2026-09-18'),
  ('Bell',   'mobile',   'lower bill',      'retention dept',   'won',     25.00, 24, 'test-row', '2026-09-05'),
  ('Bell',   'internet', 'lower bill',      'competitor price', 'partial', 15.00, 12, 'test-row', '2026-09-12'),
  ('Bell',   'mobile',   'lower bill',      'loyalty',          'lost',     NULL, NULL, 'test-row', '2026-09-25');

-- Check:
SELECT COUNT(*) FROM PLAN_PRICES;
SELECT COUNT(*) FROM DEAL_INTEL;

-- When Tony's CSVs arrive: remove the test rows FIRST, then load the files through
-- Data → Add Data → Load data into a Table (skip 1 header line, comma delimiter).
-- DELETE FROM PLAN_PRICES WHERE SOURCE_URL = 'test-row';
-- DELETE FROM DEAL_INTEL  WHERE SOURCE_URL = 'test-row';
