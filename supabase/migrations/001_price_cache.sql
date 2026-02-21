-- Price Cache Table
-- Stores cached price data from SMARD API and CSV files

CREATE TABLE IF NOT EXISTS price_cache (
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('day-ahead', 'intraday', 'forward')),
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('smard', 'csv', 'demo')),
  prices_json JSONB NOT NULL,

  PRIMARY KEY (date, type)
);

-- Index for cache expiration queries
CREATE INDEX IF NOT EXISTS idx_price_cache_cached_at ON price_cache(cached_at);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_price_cache_date ON price_cache(date);

-- Enable Row Level Security
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can read cached price data)
CREATE POLICY "Allow public read access"
  ON price_cache FOR SELECT
  TO public
  USING (true);

-- Service role write access (only server can write)
CREATE POLICY "Allow service role write access"
  ON price_cache FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Allow service role update access"
  ON price_cache FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Allow service role delete access"
  ON price_cache FOR DELETE
  TO service_role
  USING (true);

-- Grant usage to anon role for reads
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON price_cache TO anon;
