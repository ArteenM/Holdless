-- =====================================================================
-- Holdless · Snowflake worksheet (Arteen)
-- Paste into one Snowsight worksheet/workspace file. Run section by section.
-- Queries 1 and 3 live here; Query 2 (best time to call) runs on Tiger Data.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SETUP (run once)
-- ---------------------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS HOLDLESS_WH WAREHOUSE_SIZE='XSMALL' AUTO_SUSPEND=60 AUTO_RESUME=TRUE;
CREATE DATABASE IF NOT EXISTS HOLDLESS;
CREATE SCHEMA IF NOT EXISTS HOLDLESS.CORE;
USE WAREHOUSE HOLDLESS_WH;
USE SCHEMA HOLDLESS.CORE;

-- CREATE OR REPLACE wipes the table. Safe now (tables are empty); don't re-run after loading.
-- Change vs. the original plan: DATA_GB is NUMBER(10,2), because Tony's data has 0.5 GB plans
-- (plain NUMBER would round them to 1).
CREATE OR REPLACE TABLE PLAN_PRICES (
  PROVIDER       STRING,
  PLAN_TYPE      STRING,        -- 'internet' or 'mobile'
  PLAN_NAME      STRING,
  SPEED_MBPS     NUMBER,        -- internet only
  DATA_GB        NUMBER(10,2),  -- mobile only; 999 = unlimited
  MONTHLY_PRICE  NUMBER(10,2),
  PROMO_PRICE    NUMBER(10,2),  -- empty if no promo
  PROMO_MONTHS   NUMBER,
  REGION         STRING,
  SOURCE_URL     STRING,
  CHECKED_AT     DATE
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
-- 2. LOAD (Snowsight UI, not SQL)
-- Use the cleaned files in data/handoff/clean/ (Tony's data with 'unlimited' → 999
-- and Freedom 5G Home Internet left out: invite-only, prices can't be checked).
--   Data → Add Data → Load data into a Table → HOLDLESS → CORE → PLAN_PRICES → plan_prices.csv
--   File format: header lines to skip = 1, field delimiter = comma, field optionally enclosed by "
--   Repeat for DEAL_INTEL with deal_intel.csv
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 3. CHECK THE LOAD
-- ---------------------------------------------------------------------
SELECT COUNT(*) FROM PLAN_PRICES;   -- expect 52
SELECT COUNT(*) FROM DEAL_INTEL;    -- expect 19

-- Every plan should have a size; any rows here mean a column shifted.
SELECT * FROM PLAN_PRICES
WHERE IFF(PLAN_TYPE = 'internet', SPEED_MBPS, DATA_GB) IS NULL;


-- ---------------------------------------------------------------------
-- QUERY 1 · "You're overpaying $X"
-- Similar plans (half to double the user's speed or data) from OTHER providers.
-- Every line marked INPUT becomes a parameter for Mehdi.
-- ---------------------------------------------------------------------
SELECT
  MEDIAN(COALESCE(PROMO_PRICE, MONTHLY_PRICE))                  AS TYPICAL_PRICE,
  MIN(COALESCE(PROMO_PRICE, MONTHLY_PRICE))                     AS CHEAPEST_PRICE,
  MIN_BY(PROVIDER,  COALESCE(PROMO_PRICE, MONTHLY_PRICE))       AS CHEAPEST_PROVIDER,
  MIN_BY(PLAN_NAME, COALESCE(PROMO_PRICE, MONTHLY_PRICE))       AS CHEAPEST_PLAN,
  ROUND(130 - MEDIAN(COALESCE(PROMO_PRICE, MONTHLY_PRICE)), 2)  AS OVERPAY_MONTHLY,  -- INPUT: user's monthly price
  COUNT(*)                                                      AS PLANS_COMPARED
FROM PLAN_PRICES
WHERE PLAN_TYPE = 'internet'                                     -- INPUT: 'internet' | 'mobile'
  AND IFF(PLAN_TYPE = 'internet', SPEED_MBPS, DATA_GB)
      BETWEEN 500 * 0.5 AND 500 * 2                              -- INPUT: size, both 500s (Mbps, or GB; 999 = unlimited)
  AND UPPER(PROVIDER) <> UPPER('Rogers');                        -- INPUT: user's provider

-- Mobile check: PLAN_TYPE = 'mobile', size 100, price 80, provider 'Telus'.


-- ---------------------------------------------------------------------
-- QUERY 3 · "Arguments that work at this company"
-- Ranked by how often each argument worked. (Most DISCOUNT_MONTHLY values are
-- empty, and Snowflake sorts empty values FIRST on DESC, so sorting by discount
-- alone would put arguments with no data on top.)
-- ---------------------------------------------------------------------
SELECT ARGUMENT_USED,
       COUNT(*)                        AS TIMES_WORKED,
       ROUND(AVG(DISCOUNT_MONTHLY), 2) AS AVG_DISCOUNT,
       MAX(DURATION_MONTHS)            AS BEST_DURATION
FROM DEAL_INTEL
WHERE UPPER(COMPANY) = UPPER('Rogers')                           -- INPUT: company
  AND RESULT IN ('won', 'partial')
GROUP BY ARGUMENT_USED
ORDER BY TIMES_WORKED DESC, AVG_DISCOUNT DESC NULLS LAST, ARGUMENT_USED
LIMIT 3;
