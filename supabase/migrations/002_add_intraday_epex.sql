-- Add support for EPEX intraday data and quarter-hourly cache types
-- Fixes the check constraint that was blocking 'day-ahead-qh' writes

-- Drop the old restrictive constraints
ALTER TABLE price_cache DROP CONSTRAINT IF EXISTS price_cache_type_check;
ALTER TABLE price_cache DROP CONSTRAINT IF EXISTS price_cache_source_check;

-- Re-create with expanded values
ALTER TABLE price_cache ADD CONSTRAINT price_cache_type_check
  CHECK (type IN ('day-ahead', 'day-ahead-qh', 'intraday', 'intraday-qh', 'forward'));

ALTER TABLE price_cache ADD CONSTRAINT price_cache_source_check
  CHECK (source IN ('smard', 'csv', 'demo', 'awattar', 'energy-charts', 'epex'));
