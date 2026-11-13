ALTER TABLE appointments ADD COLUMN completed_at TEXT;
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN completed_cents INTEGER;
--> statement-breakpoint
CREATE INDEX appointments_operations ON appointments(day, status);
--> statement-breakpoint
CREATE TABLE loyalty_rewards (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX loyalty_rewards_client ON loyalty_rewards(email);
