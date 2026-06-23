ALTER TABLE brick_requests ADD COLUMN surface TEXT;
ALTER TABLE brick_requests ADD COLUMN confidence TEXT;
ALTER TABLE brick_requests ADD COLUMN engine_id TEXT;

CREATE INDEX IF NOT EXISTS brick_requests_surface_idx ON brick_requests(surface);
CREATE INDEX IF NOT EXISTS brick_requests_confidence_idx ON brick_requests(confidence);
CREATE INDEX IF NOT EXISTS brick_requests_engine_id_idx ON brick_requests(engine_id);
