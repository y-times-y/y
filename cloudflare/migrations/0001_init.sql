CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  context_json TEXT,
  app_version TEXT,
  platform TEXT,
  source TEXT NOT NULL DEFAULT 'desktop',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback(created_at);
CREATE INDEX IF NOT EXISTS feedback_category_idx ON feedback(category);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  anonymous_id TEXT,
  user_id TEXT,
  props_json TEXT,
  app_version TEXT,
  platform TEXT,
  source TEXT NOT NULL DEFAULT 'desktop',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at);
CREATE INDEX IF NOT EXISTS events_name_idx ON events(name);
CREATE INDEX IF NOT EXISTS events_anonymous_id_idx ON events(anonymous_id);

CREATE TABLE IF NOT EXISTS brick_requests (
  id TEXT PRIMARY KEY,
  brick TEXT NOT NULL,
  reason TEXT,
  context_json TEXT,
  source TEXT NOT NULL DEFAULT 'model',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS brick_requests_created_at_idx ON brick_requests(created_at);
CREATE INDEX IF NOT EXISTS brick_requests_brick_idx ON brick_requests(brick);
