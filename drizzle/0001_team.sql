CREATE TABLE team_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('dev','master','barber')),
  barber TEXT,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  CHECK((role='barber' AND barber IS NOT NULL) OR (role!='barber' AND barber IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX team_single_dev ON team_accounts(role) WHERE role='dev';
--> statement-breakpoint
CREATE UNIQUE INDEX team_single_master ON team_accounts(role) WHERE role='master';
--> statement-breakpoint
CREATE UNIQUE INDEX team_single_barber ON team_accounts(barber) WHERE role='barber';
--> statement-breakpoint
CREATE TABLE team_sessions (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES team_accounts(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX team_sessions_account ON team_sessions(account);
--> statement-breakpoint
CREATE TABLE team_attempts (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
