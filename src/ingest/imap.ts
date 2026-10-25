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

const INITIAL_LOOKBACK_HOURS = 48;
const MAX_MESSAGES_PER_SYNC = 50;
const MAX_BODY_BYTES = 100_000; // 100 KB cap per message body (avoids downloading large attachments)

function collectAttachments(node?: any, acc: { filename?: string }[] = []): { filename?: string }[] {
  if (!node) return acc;
  const filename = node.dispositionParameters?.filename || node.parameters?.name;
  if (filename && (node.disposition === 'attachment' || !String(node.type || '').startsWith('text/'))) {
    acc.push({ filename });
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      collectAttachments(child, acc);
    }
  }
  return acc;
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
      if (mailbox && mailbox.exists > 0) {
        const uidvalidity = String(mailbox.uidValidity);
        const cursor = dbService.getCursor(accountId, 'INBOX');

        let lastUid = 0;
        if (cursor && cursor.uidvalidity === uidvalidity) {
          lastUid = cursor.last_uid;
        }

        let targetUids: number[] = [];
        if (lastUid > 0) {
          const found = await imap.search({ uid: `${lastUid + 1}:*` }, { uid: true });
          targetUids = (found || []).filter((u) => u > lastUid).slice(-MAX_MESSAGES_PER_SYNC);
        } else {
          // First run: only look back 48 hours (capped at MAX_MESSAGES_PER_SYNC) instead of entire mailbox history
          const since = new Date(Date.now() - INITIAL_LOOKBACK_HOURS * 3600 * 1000);
          const found = await imap.search({ since }, { uid: true });
          targetUids = (found || []).slice(-MAX_MESSAGES_PER_SYNC);
        }

        if (targetUids.length > 0) {
          let highestUid = lastUid;

          for await (const message of imap.fetch(
            targetUids,
            {
              uid: true,
              envelope: true,
              bodyStructure: true,
              headers: ['x-gm-thrid', 'list-unsubscribe', 'precedence', 'references', 'in-reply-to'],
              source: { maxLength: MAX_BODY_BYTES },
            },
            { uid: true }
          )) {
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

            // Strip top-level RFC822 header block from capped 100 KB source
            const rawSource = message.source ? message.source.toString('utf-8') : '';
            const headerEndIdx = rawSource.search(/\r?\n\r?\n/);
            const rawBody = headerEndIdx >= 0 ? rawSource.slice(headerEndIdx).trim() : rawSource;

            const attachments = collectAttachments(message.bodyStructure);
            const cleaned = cleanEmailBody(rawBody, false, attachments);

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
        } else if (lastUid === 0 && mailbox.uidNext) {
          // Record current mailbox head so subsequent runs only inspect newly arriving mail
          dbService.setCursor(accountId, 'INBOX', uidvalidity, Math.max(0, Number(mailbox.uidNext) - 1));
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

          let targetSentUids: number[] = [];
          if (lastUid > 0) {
            const found = await imap.search({ uid: `${lastUid + 1}:*` }, { uid: true });
            targetSentUids = (found || []).filter((u) => u > lastUid).slice(-MAX_MESSAGES_PER_SYNC);
          } else {
            const since = new Date(Date.now() - INITIAL_LOOKBACK_HOURS * 3600 * 1000);
            const found = await imap.search({ since }, { uid: true });
            targetSentUids = (found || []).slice(-MAX_MESSAGES_PER_SYNC);
          }

          if (targetSentUids.length > 0) {
            let highestUid = lastUid;

            for await (const message of imap.fetch(
              targetSentUids,
              {
                uid: true,
                envelope: true,
                headers: ['x-gm-thrid', 'in-reply-to', 'references'],
              },
              { uid: true }
            )) {
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
          } else if (lastUid === 0 && mailbox.uidNext) {
            dbService.setCursor(accountId, 'SENT', uidvalidity, Math.max(0, Number(mailbox.uidNext) - 1));
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
