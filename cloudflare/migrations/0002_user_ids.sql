ALTER TABLE feedback ADD COLUMN user_id TEXT;
ALTER TABLE brick_requests ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS feedback_user_id_idx ON feedback(user_id);
CREATE INDEX IF NOT EXISTS brick_requests_user_id_idx ON brick_requests(user_id);
