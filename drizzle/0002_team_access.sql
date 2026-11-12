ALTER TABLE team_accounts ADD COLUMN invite_hash TEXT;
--> statement-breakpoint
ALTER TABLE team_accounts ADD COLUMN invite_expires INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX team_invites_token ON team_accounts(invite_hash) WHERE invite_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE team_accounts ADD COLUMN mfa_secret TEXT;
--> statement-breakpoint
ALTER TABLE team_accounts ADD COLUMN mfa_step INTEGER NOT NULL DEFAULT -1;
--> statement-breakpoint
ALTER TABLE team_accounts ADD COLUMN recovery_hash TEXT;
--> statement-breakpoint
ALTER TABLE team_sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
DELETE FROM team_sessions WHERE account IN (SELECT id FROM team_accounts WHERE role IN ('dev','master'));
--> statement-breakpoint
CREATE TABLE team_challenges (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES team_accounts(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  enrollment_secret TEXT
);
