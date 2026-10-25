export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS cursors (
  account_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  uidvalidity TEXT NOT NULL,
  last_uid INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, mailbox)
);

CREATE TABLE IF NOT EXISTS emails (
  message_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  uid INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT,
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  body_cleaned TEXT NOT NULL,
  raw_headers_json TEXT,
  category TEXT,
  confidence REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_category ON emails (category);
CREATE INDEX IF NOT EXISTS idx_emails_account_mailbox ON emails (account_id, mailbox);

CREATE TABLE IF NOT EXISTS reply_debt (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  ask_summary TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'dismissed')),
  resolved_at TEXT,
  resolved_by_msg_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_reply_debt_status ON reply_debt (status);
CREATE INDEX IF NOT EXISTS idx_reply_debt_thread ON reply_debt (thread_id);

CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  digest_date TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  threads_summarized INTEGER NOT NULL DEFAULT 0,
  emails_processed INTEGER NOT NULL DEFAULT 0,
  newsletters_skipped INTEGER NOT NULL DEFAULT 0,
  words_read INTEGER NOT NULL DEFAULT 0,
  read_time_saved_minutes REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL
);
`;
