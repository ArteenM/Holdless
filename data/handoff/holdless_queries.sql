-- =====================================================================
-- Holdless · the 3 data queries (Arteen → Mehdi)
-- Lines marked INPUT are the values to turn into parameters.
-- Run against: Q1 + Q3 Snowflake (HOLDLESS.CORE, warehouse HOLDLESS_WH), Q2 Tiger Data.
-- =====================================================================


-- ---------------------------------------------------------------------
-- QUERY 1 · "You're overpaying $X"  (Snowflake)
-- Compares the user's price with similar plans (half to double the speed or data) from OTHER providers.
-- ---------------------------------------------------------------------
SELECT
  MEDIAN(COALESCE(PROMO_PRICE, MONTHLY_PRICE))                     AS TYPICAL_PRICE,
  MIN(COALESCE(PROMO_PRICE, MONTHLY_PRICE))                        AS CHEAPEST_PRICE,
  MIN_BY(PROVIDER,  COALESCE(PROMO_PRICE, MONTHLY_PRICE))          AS CHEAPEST_PROVIDER,
  MIN_BY(PLAN_NAME, COALESCE(PROMO_PRICE, MONTHLY_PRICE))          AS CHEAPEST_PLAN,
  ROUND(130 - MEDIAN(COALESCE(PROMO_PRICE, MONTHLY_PRICE)), 2)      AS OVERPAY_MONTHLY,  -- INPUT: user's monthly price
  COUNT(*)                                                         AS PLANS_COMPARED
FROM PLAN_PRICES
WHERE PLAN_TYPE = 'internet'                                                 -- INPUT: plan type ('internet' | 'mobile')
  AND IFF(PLAN_TYPE = 'internet', SPEED_MBPS, DATA_GB)
      BETWEEN 500 * 0.5 AND 500 * 2                                          -- INPUT: size, both 500s (Mbps, or GB; 999 = unlimited)
  AND UPPER(PROVIDER) <> UPPER('Rogers');                                    -- INPUT: user's provider

-- Mobile check: PLAN_TYPE = 'mobile', size 100, price 80, provider 'Telus'.


-- ---------------------------------------------------------------------
-- QUERY 2 · "Best time to call"  (Tiger Data)
-- Converts to Vancouver time itself, so it gives the same answer from the SQL
-- editor and from the app's connection (which defaults to UTC).
-- ---------------------------------------------------------------------
SELECT to_char(bucket AT TIME ZONE 'America/Vancouver', 'Dy')              AS day,
       extract(hour FROM bucket AT TIME ZONE 'America/Vancouver')::int     AS hour,
       round(sum(avg_hold * calls) / sum(calls) / 60, 1)                   AS avg_hold_min,
       sum(calls)                                                          AS calls
FROM hold_by_hour
WHERE company = 'Rogers'                                                   -- INPUT: company
  AND bucket > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY avg_hold_min ASC
LIMIT 3;


-- ---------------------------------------------------------------------
-- QUERY 3 · "Arguments that work at this company"  (Snowflake)
-- ---------------------------------------------------------------------
SELECT ARGUMENT_USED,
       COUNT(*)                        AS TIMES_WORKED,
       ROUND(AVG(DISCOUNT_MONTHLY), 2) AS AVG_DISCOUNT,
       MAX(DURATION_MONTHS)            AS BEST_DURATION
FROM DEAL_INTEL
WHERE UPPER(COMPANY) = UPPER('Rogers')                                     -- INPUT: company
  AND RESULT IN ('won', 'partial')
GROUP BY ARGUMENT_USED
ORDER BY TIMES_WORKED DESC, AVG_DISCOUNT DESC NULLS LAST, ARGUMENT_USED
LIMIT 3;
