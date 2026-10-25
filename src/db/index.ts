import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { CREATE_TABLES_SQL } from './schema.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(config.storage.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  dbInstance = new Database(config.storage.dbPath);
  try {
    fs.chmodSync(config.storage.dbPath, 0o600);
  } catch {
    // Ignore chmod errors on non-POSIX filesystems
  }
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.exec(CREATE_TABLES_SQL);
  return dbInstance;
}

export interface CursorRecord {
  account_id: string;
  mailbox: string;
  uidvalidity: string;
  last_uid: number;
  updated_at: string;
}

export interface EmailRecord {
  message_id: string;
  account_id: string;
  thread_id: string;
  mailbox: string;
  uid: number;
  from_addr: string;
  to_addr: string | null;
  subject: string;
  date: string;
  body_cleaned: string;
  raw_headers_json: string | null;
  category: 'personal' | 'transactional' | 'bulk' | null;
  confidence: number | null;
  created_at: string;
}

export interface ReplyDebtRecord {
  id: string;
  account_id: string;
  thread_id: string;
  message_id: string;
  subject: string;
  from_addr: string;
  ask_summary: string;
  detected_at: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolved_at: string | null;
  resolved_by_msg_id: string | null;
}

export interface DigestRecord {
  id: string;
  digest_date: string;
  title: string;
  summary_markdown: string;
  threads_summarized: number;
  emails_processed: number;
  newsletters_skipped: number;
  words_read: number;
  read_time_saved_minutes: number;
  created_at: string;
}

export const dbService = {
  getCursor(accountId: string, mailbox: string): CursorRecord | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cursors WHERE account_id = ? AND mailbox = ?').get(accountId, mailbox);
    return (row as CursorRecord) || null;
  },

  setCursor(accountId: string, mailbox: string, uidvalidity: string, lastUid: number): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cursors (account_id, mailbox, uidvalidity, last_uid, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, mailbox) DO UPDATE SET
        uidvalidity = excluded.uidvalidity,
        last_uid = excluded.last_uid,
        updated_at = excluded.updated_at
    `).run(accountId, mailbox, uidvalidity, lastUid, now);
  },

  saveEmail(email: Omit<EmailRecord, 'created_at'>): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO emails (
        message_id, account_id, thread_id, mailbox, uid,
        from_addr, to_addr, subject, date, body_cleaned,
        raw_headers_json, category, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        category = COALESCE(excluded.category, emails.category),
        confidence = COALESCE(excluded.confidence, emails.confidence)
    `).run(
      email.message_id,
      email.account_id,
      email.thread_id,
      email.mailbox,
      email.uid,
      email.from_addr,
      email.to_addr,
      email.subject,
      email.date,
      email.body_cleaned,
      email.raw_headers_json,
      email.category,
      email.confidence,
      now
    );
  },

  updateEmailCategory(messageId: string, category: 'personal' | 'transactional' | 'bulk', confidence: number): void {
    const db = getDb();
    db.prepare(`
      UPDATE emails SET category = ?, confidence = ? WHERE message_id = ?
    `).run(category, confidence, messageId);
  },

  getEmailByMessageId(messageId: string): EmailRecord | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM emails WHERE message_id = ?').get(messageId);
    return (row as EmailRecord) || null;
  },

  getUnclassifiedEmails(): EmailRecord[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM emails WHERE category IS NULL').all();
    return rows as EmailRecord[];
  },

  getEmailsByThread(threadId: string): EmailRecord[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM emails WHERE thread_id = ? ORDER BY date ASC').all(threadId);
    return rows as EmailRecord[];
  },

  getPersonalThreadsSince(sinceIso: string): { thread_id: string; subject: string; count: number }[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT thread_id, subject, count(*) as count
      FROM emails
      WHERE category = 'personal' AND date >= ?
      GROUP BY thread_id
      ORDER BY max(date) DESC
    `).all(sinceIso);
    return rows as { thread_id: string; subject: string; count: number }[];
  },

  addReplyDebt(debt: Omit<ReplyDebtRecord, 'status' | 'resolved_at' | 'resolved_by_msg_id'>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO reply_debt (
        id, account_id, thread_id, message_id, subject, from_addr, ask_summary, detected_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
      ON CONFLICT(id) DO NOTHING
    `).run(
      debt.id,
      debt.account_id,
      debt.thread_id,
      debt.message_id,
      debt.subject,
      debt.from_addr,
      debt.ask_summary,
      debt.detected_at
    );
  },

  getOpenReplyDebt(): ReplyDebtRecord[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM reply_debt WHERE status = \'open\' ORDER BY detected_at ASC').all();
    return rows as ReplyDebtRecord[];
  },

  resolveReplyDebtByThread(threadId: string, resolvedByMsgId: string): number {
    const db = getDb();
    const now = new Date().toISOString();
    const info = db.prepare(`
      UPDATE reply_debt
      SET status = 'resolved', resolved_at = ?, resolved_by_msg_id = ?
      WHERE thread_id = ? AND status = 'open'
    `).run(now, resolvedByMsgId, threadId);
    return info.changes;
  },

  dismissReplyDebt(debtId: string): boolean {
    const db = getDb();
    const now = new Date().toISOString();
    const info = db.prepare(`
      UPDATE reply_debt
      SET status = 'dismissed', resolved_at = ?
      WHERE id = ? AND status = 'open'
    `).run(now, debtId);
    return info.changes > 0;
  },

  saveDigest(digest: DigestRecord): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO digests (
        id, digest_date, title, summary_markdown, threads_summarized,
        emails_processed, newsletters_skipped, words_read,
        read_time_saved_minutes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest_date) DO UPDATE SET
        summary_markdown = excluded.summary_markdown,
        threads_summarized = excluded.threads_summarized,
        emails_processed = excluded.emails_processed,
        newsletters_skipped = excluded.newsletters_skipped,
        words_read = excluded.words_read,
        read_time_saved_minutes = excluded.read_time_saved_minutes
    `).run(
      digest.id,
      digest.digest_date,
      digest.title,
      digest.summary_markdown,
      digest.threads_summarized,
      digest.emails_processed,
      digest.newsletters_skipped,
      digest.words_read,
      digest.read_time_saved_minutes,
      digest.created_at
    );
  },

  getRecentDigests(limit = 14): DigestRecord[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM digests ORDER BY digest_date DESC LIMIT ?').all(limit);
    return rows as DigestRecord[];
  },
};
