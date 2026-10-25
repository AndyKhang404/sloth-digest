import { ImapFlow } from 'imapflow';
import { config } from '../config.js';
import { dbService, EmailRecord } from '../db/index.js';
import { cleanEmailBody } from './cleaner.js';

export interface IngestResult {
  inboxFetched: number;
  sentFetched: number;
  newEmails: EmailRecord[];
  sentReplies: {
    messageId: string;
    inReplyTo?: string;
    references?: string[];
    threadId: string;
    date: string;
  }[];
}

export function createImapClient(): ImapFlow {
  if (!config.gmail.user || !config.gmail.appPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be configured.');
  }

  return new ImapFlow({
    host: config.gmail.host,
    port: config.gmail.port,
    secure: config.gmail.secure,
    auth: {
      user: config.gmail.user,
      pass: config.gmail.appPassword,
    },
    logger: false,
  });
}

/**
 * Ingest new messages from INBOX and Sent mailbox in read-only EXAMINE mode.
 */
export async function ingestGmailMessages(client?: ImapFlow): Promise<IngestResult> {
  const imap = client || createImapClient();
  const shouldClose = !client;

  if (shouldClose) {
    await imap.connect();
  }

  const accountId = config.gmail.user;
  const newEmails: EmailRecord[] = [];
  const sentReplies: IngestResult['sentReplies'] = [];
  let inboxCount = 0;
  let sentCount = 0;

  try {
    // ----------------------------------------------------
    // 1. Process INBOX (read-only EXAMINE)
    // ----------------------------------------------------
    const inboxLock = await imap.getMailboxLock('INBOX', { readOnly: true });
    try {
      const mailbox = imap.mailbox;
      if (mailbox) {
        const uidvalidity = String(mailbox.uidValidity);
        const cursor = dbService.getCursor(accountId, 'INBOX');

        let lastUid = 0;
        if (cursor && cursor.uidvalidity === uidvalidity) {
          lastUid = cursor.last_uid;
        }

        const range = `${lastUid + 1}:*`;
        if (mailbox.exists > 0) {
          let highestUid = lastUid;

          for await (const message of imap.fetch(range, {
            uid: true,
            envelope: true,
            headers: ['x-gm-thrid', 'list-unsubscribe', 'precedence', 'references', 'in-reply-to'],
            bodyParts: ['text'],
            source: true,
          })) {
            if (message.uid <= lastUid) continue;
            if (message.uid > highestUid) highestUid = message.uid;

            const envelope = message.envelope;
            if (!envelope) continue;

            const messageId = envelope.messageId || `<uid-${message.uid}@gmail.com>`;
            const fromAddr = envelope.from?.[0]?.address || envelope.from?.[0]?.name || 'unknown';
            const toAddr = envelope.to?.[0]?.address || envelope.to?.[0]?.name || null;
            const subject = envelope.subject || '(no subject)';
            const date = envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString();

            // Headers
            const rawHeaders = message.headers ? message.headers.toString() : '';
            const threadMatch = rawHeaders.match(/x-gm-thrid:\s*([0-9]+)/i);
            const inReplyToMatch = rawHeaders.match(/in-reply-to:\s*(<[^>]+>)/i);

            // Use Gmail thread ID if present, otherwise group by In-Reply-To or subject
            const threadId = threadMatch
              ? `gm-${threadMatch[1]}`
              : inReplyToMatch
              ? `ref-${inReplyToMatch[1]}`
              : `subj-${subject.toLowerCase().replace(/^(re|fwd):\s*/i, '').trim()}`;

            // Body text
            const rawBody = message.source ? message.source.toString() : '';
            const cleaned = cleanEmailBody(rawBody);

            const emailRecord: Omit<EmailRecord, 'created_at'> = {
              message_id: messageId,
              account_id: accountId,
              thread_id: threadId,
              mailbox: 'INBOX',
              uid: message.uid,
              from_addr: fromAddr,
              to_addr: toAddr,
              subject,
              date,
              body_cleaned: cleaned.text,
              raw_headers_json: JSON.stringify({
                listUnsubscribe: /list-unsubscribe:/i.test(rawHeaders),
                precedenceBulk: /precedence:\s*(bulk|list|junk)/i.test(rawHeaders),
                isNoReply: /no-?reply/i.test(fromAddr),
              }),
              category: null,
              confidence: null,
            };

            dbService.saveEmail(emailRecord);
            newEmails.push({ ...emailRecord, created_at: new Date().toISOString() });
            inboxCount++;
          }

          if (highestUid > lastUid) {
            dbService.setCursor(accountId, 'INBOX', uidvalidity, highestUid);
          }
        }
      }
    } finally {
      inboxLock.release();
    }

    // ----------------------------------------------------
    // 2. Process Sent Mail (read-only EXAMINE to resolve debt)
    // ----------------------------------------------------
    // Gmail standard sent folder is "[Gmail]/Sent Mail"
    let sentMailboxName = '[Gmail]/Sent Mail';
    const mailboxes = await imap.list();
    const foundSent = mailboxes.find(
      (m) => m.specialUse === '\\Sent' || m.path.toLowerCase().includes('sent')
    );
    if (foundSent) {
      sentMailboxName = foundSent.path;
    }

    try {
      const sentLock = await imap.getMailboxLock(sentMailboxName, { readOnly: true });
      try {
        const mailbox = imap.mailbox;
        if (mailbox && mailbox.exists > 0) {
          const uidvalidity = String(mailbox.uidValidity);
          const cursor = dbService.getCursor(accountId, 'SENT');

          let lastUid = 0;
          if (cursor && cursor.uidvalidity === uidvalidity) {
            lastUid = cursor.last_uid;
          }

          const range = `${lastUid + 1}:*`;
          let highestUid = lastUid;

          for await (const message of imap.fetch(range, {
            uid: true,
            envelope: true,
            headers: ['x-gm-thrid', 'in-reply-to', 'references'],
          })) {
            if (message.uid <= lastUid) continue;
            if (message.uid > highestUid) highestUid = message.uid;

            const envelope = message.envelope;
            if (!envelope) continue;

            const messageId = envelope.messageId || `<sent-uid-${message.uid}@gmail.com>`;
            const rawHeaders = message.headers ? message.headers.toString() : '';
            const threadMatch = rawHeaders.match(/x-gm-thrid:\s*([0-9]+)/i);
            const inReplyToMatch = rawHeaders.match(/in-reply-to:\s*(<[^>]+>)/i);
            const date = envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString();

            const threadId = threadMatch
              ? `gm-${threadMatch[1]}`
              : inReplyToMatch
              ? `ref-${inReplyToMatch[1]}`
              : `subj-${(envelope.subject || '').toLowerCase().replace(/^(re|fwd):\s*/i, '').trim()}`;

            sentReplies.push({
              messageId,
              inReplyTo: inReplyToMatch ? inReplyToMatch[1] : undefined,
              threadId,
              date,
            });
            sentCount++;
          }

          if (highestUid > lastUid) {
            dbService.setCursor(accountId, 'SENT', uidvalidity, highestUid);
          }
        }
      } finally {
        sentLock.release();
      }
    } catch (sentErr) {
      // If Sent folder lookup fails (e.g. non-standard folder name on custom IMAP), log but don't abort
      console.warn(`[ingest] Could not inspect Sent folder '${sentMailboxName}':`, (sentErr as Error).message);
    }
  } finally {
    if (shouldClose) {
      await imap.logout();
    }
  }

  return {
    inboxFetched: inboxCount,
    sentFetched: sentCount,
    newEmails,
    sentReplies,
  };
}
