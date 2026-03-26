-- Add NL (Netherlands) country-prefixed cache types
-- Convention: non-DE countries use prefix 'xx:' (e.g., 'nl:day-ahead', 'nl:intraday')

ALTER TABLE price_cache DROP CONSTRAINT IF EXISTS price_cache_type_check;

ALTER TABLE price_cache ADD CONSTRAINT price_cache_type_check
  CHECK (type IN (
    'day-ahead', 'day-ahead-qh', 'intraday', 'intraday-qh', 'forward',
    'nl:day-ahead', 'nl:day-ahead-qh', 'nl:intraday', 'nl:intraday-qh', 'nl:forward'
  ));
