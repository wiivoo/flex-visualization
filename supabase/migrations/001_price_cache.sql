-- Price Cache Table
-- Stores cached price data from SMARD API and CSV files

CREATE TABLE IF NOT EXISTS price_cache (
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('day-ahead', 'intraday', 'forward')),
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('smard', 'csv', 'demo', 'awattar', 'energy-charts')),
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

-- Allow anon role to write (app uses anon key for cache writes)
CREATE POLICY "Allow anon write access"
  ON price_cache FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update access"
  ON price_cache FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "Allow anon delete access"
  ON price_cache FOR DELETE
  TO anon
  USING (true);

-- Grant usage to anon role
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON price_cache TO anon;
