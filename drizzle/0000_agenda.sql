CREATE TABLE appointments (
 id TEXT PRIMARY KEY, barber TEXT NOT NULL, day TEXT NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL,
 service TEXT, name TEXT, email TEXT, status TEXT NOT NULL CHECK(status IN ('booked','blocked','cancelled')),
 email_sent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(starts >= 0 AND ends <= 1440 AND starts < ends)
);
--> statement-breakpoint
CREATE INDEX appointments_agenda ON appointments (barber, day, status, starts, ends);
--> statement-breakpoint
CREATE TABLE working_hours (
 barber TEXT NOT NULL, weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), windows TEXT NOT NULL,
 PRIMARY KEY(barber, weekday)
);
