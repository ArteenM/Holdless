-- Holdless deal intel on Snowflake.
-- Run once:  snowsql -f data/sql/snowflake/001_schema.sql   (or paste into a worksheet)
-- Then seed: python -m holdless_data.seed snowflake

CREATE DATABASE IF NOT EXISTS HOLDLESS;
CREATE SCHEMA IF NOT EXISTS HOLDLESS.INTEL;
USE SCHEMA HOLDLESS.INTEL;

-- Public plan prices: what each provider advertises, per province and speed/data tier.
CREATE TABLE IF NOT EXISTS plan_prices (
    provider       STRING        NOT NULL,   -- normalized slug: rogers, telus, fido ...
    parent         STRING        NOT NULL,   -- owning company: fido -> rogers
    service        STRING        NOT NULL,   -- internet | mobile | tv | ...
    plan_name      STRING        NOT NULL,
    tier           STRING,                   -- basic | mid | gig | multi_gig | small | mid | large | unlimited
    download_mbps  NUMBER(8,0),
    data_gb        NUMBER(8,0),
    price          NUMBER(10,2)  NOT NULL,   -- monthly, CAD, before tax (promo price if one is advertised)
    promo_months   NUMBER(4,0),
    regular_price  NUMBER(10,2),
    province       STRING        NOT NULL,
    source_url     STRING,
    observed_at    DATE
);

-- Every negotiation outcome: seeded examples plus one row per finished Holdless call.
-- This is the crowd-sourced "people near you pay" signal and the voice agent's playbook.
CREATE TABLE IF NOT EXISTS deal_intel (
    call_id         STRING        NOT NULL,
    company         STRING        NOT NULL,
    service         STRING        NOT NULL,
    tier            STRING,
    province        STRING,
    city            STRING,
    start_price     NUMBER(10,2),          -- monthly price before the call
    first_offer     NUMBER(10,2),          -- monthly reduction the rep offered first
    achieved_price  NUMBER(10,2),          -- monthly price after the call
    months          NUMBER(4,0),           -- how long the deal lasts
    argument        STRING,                -- competitor_match | loyalty | cancel_threat | supervisor | consumer_rights | hardship
    vibe            STRING,                -- polite | relentless | lawyer | grandma
    outcome         STRING,                -- win | partial | no_deal | cancelled | escalated | incomplete
    source          STRING,                -- seed | call
    created_at      TIMESTAMP_TZ  NOT NULL
);

-- Handy for the Devpost screenshot / judges: market price per plan bucket.
CREATE OR REPLACE VIEW market_by_tier AS
WITH market AS (
    SELECT service, province, tier, provider AS company, price AS monthly, 'public' AS kind FROM plan_prices
    UNION ALL
    SELECT service, province, tier, company, achieved_price, 'crowd' FROM deal_intel WHERE outcome = 'win'
)
SELECT service, province, tier,
       COUNT(*)              AS samples,
       MEDIAN(monthly)       AS people_near_you_pay,
       MIN(monthly)          AS cheapest,
       MAX(monthly)          AS priciest,
       COUNT_IF(kind = 'crowd') AS crowd_samples
FROM market
GROUP BY service, province, tier;
