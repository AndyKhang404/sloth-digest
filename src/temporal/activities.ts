import { Context } from '@temporalio/activity';
import { ingestGmailMessages } from '../ingest/imap.js';
import { dbService, getDb, EmailRecord } from '../db/index.js';
import { classifyEmailWithGemma, summarizeThreadWithGemma, generateOverallOverviewWithGemma } from '../agent/mastra.js';
import { debtEngine } from '../engine/debt.js';
import { generateDigestMarkdown } from '../deliver/markdown.js';
import { sendNtfyDigest } from '../deliver/ntfy.js';
import { config } from '../config.js';
import crypto from 'node:crypto';

function safeHeartbeat(details: unknown) {
  try {
    Context.current().heartbeat(details);
  } catch {
    // Running in standalone test or outside active Temporal activity
  }
}

export interface IngestActivityResult {
  inboxFetched: number;
  sentFetched: number;
  newEmailIds: string[];
  sentRepliesCount: number;
}

export async function fetchNewEmailsActivity(): Promise<IngestActivityResult> {
  safeHeartbeat('Connecting to IMAP and fetching new emails...');

  const result = await ingestGmailMessages();
  safeHeartbeat(`Fetched ${result.inboxFetched} inbox emails, ${result.sentFetched} sent emails`);

  // Reconcile sent replies against existing reply debt immediately
  const recon = debtEngine.reconcileSentReplies(result.sentReplies);

  return {
    inboxFetched: result.inboxFetched,
    sentFetched: result.sentFetched,
    newEmailIds: result.newEmails.map((e) => e.message_id),
    sentRepliesCount: recon.resolvedCount,
  };
}

export async function classifyEmailsActivity(): Promise<{
  classifiedCount: number;
  personalCount: number;
  bulkCount: number;
  transactionalCount: number;
}> {
  const unclassified = dbService.getUnclassifiedEmails();

  let personal = 0;
  let bulk = 0;
  let transactional = 0;

  for (let i = 0; i < unclassified.length; i++) {
    const email = unclassified[i];
    safeHeartbeat(`Classifying email ${i + 1}/${unclassified.length}: ${email.subject}`);

    const res = await classifyEmailWithGemma(email);
    dbService.updateEmailCategory(email.message_id, res.category, res.confidence);

    if (res.category === 'personal') personal++;
    else if (res.category === 'bulk') bulk++;
    else transactional++;
  }

  return {
    classifiedCount: unclassified.length,
    personalCount: personal,
    bulkCount: bulk,
    transactionalCount: transactional,
  };
}

export async function getActiveThreadsActivity(sinceIso: string): Promise<{ threadId: string; subject: string }[]> {
  const threads = dbService.getPersonalThreadsSince(sinceIso);
  return threads.map((t) => ({ threadId: t.thread_id, subject: t.subject }));
}

export interface SummarizeThreadInput {
  threadId: string;
  subject: string;
}

export interface SummarizeThreadOutput {
  threadId: string;
  subject: string;
  summary: [string, string];
  emailCount: number;
  hasNewAsk: boolean;
  debtId?: string;
}

export async function summarizeThreadActivity(input: SummarizeThreadInput): Promise<SummarizeThreadOutput> {
  safeHeartbeat(`Summarizing thread: ${input.subject}`);

  const messages = dbService.getEmailsByThread(input.threadId);
  const personalMessages = messages.filter((m) => m.category === 'personal');
  const targetMessages = personalMessages.length > 0 ? personalMessages : messages;

  const result = await summarizeThreadWithGemma(input.subject, targetMessages);

  let debtId: string | undefined;
  if (result.needs_reply && result.cited_message_ids.length > 0) {
    const targetMsgId = result.cited_message_ids[0];
    const sourceMsg = messages.find((m) => m.message_id === targetMsgId) || messages[messages.length - 1];

    debtId = crypto.randomUUID();
    dbService.addReplyDebt({
      id: debtId,
      account_id: config.gmail.user || 'local-user',
      thread_id: input.threadId,
      message_id: targetMsgId,
      subject: input.subject,
      from_addr: sourceMsg?.from_addr || 'unknown',
      ask_summary: result.reply_reason || 'Direct question/request requiring your reply',
      detected_at: new Date().toISOString(),
    });
  }

  return {
    threadId: input.threadId,
    subject: input.subject,
    summary: result.thread_summary,
    emailCount: targetMessages.length,
    hasNewAsk: Boolean(result.needs_reply),
    debtId,
  };
}

export interface ReduceDigestInput {
  threadOutputs: SummarizeThreadOutput[];
  sinceIso: string;
}

export async function reduceAndGenerateDigestActivity(input: ReduceDigestInput): Promise<{
  digestId: string;
  dateIso: string;
  markdownPath: string;
  minutesSaved: number;
}> {
  safeHeartbeat('Reducing thread summaries into executive briefing...');

  const activeDebts = dbService.getOpenReplyDebt();
  const allPersonalEmails = getDb().prepare(`
    SELECT body_cleaned FROM emails WHERE category = 'personal' AND date >= ?
  `).all(input.sinceIso) as { body_cleaned: string }[];

  const bulkCountRow = getDb().prepare(`
    SELECT count(*) as count FROM emails WHERE category = 'bulk' AND date >= ?
  `).get(input.sinceIso) as { count: number };

  const totalWordsIngested = allPersonalEmails.reduce((acc, curr) => {
    return acc + curr.body_cleaned.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  // Generate 2-line overview using Gemma
  const threadSummaries = input.threadOutputs.map((t) => ({
    subject: t.subject,
    summary: t.summary,
  }));

  const overviewResult = await generateOverallOverviewWithGemma(
    threadSummaries,
    activeDebts.length,
    bulkCountRow?.count || 0
  );

  // Calculate lazy payoff
  const approxDigestWords = 350; // average markdown digest word length
  const payoff = debtEngine.calculateLazyPayoff(totalWordsIngested, approxDigestWords);

  const dateIso = new Date().toISOString().slice(0, 10);
  const digestId = crypto.randomUUID();

  const markdown = generateDigestMarkdown({
    dateIso,
    overview: overviewResult.overview,
    threads: input.threadOutputs,
    activeDebts,
    resolvedDebtsCount: 0,
    newslettersSkipped: bulkCountRow?.count || 0,
    totalEmailsProcessed: allPersonalEmails.length + (bulkCountRow?.count || 0),
    payoff,
  });

  dbService.saveDigest({
    id: digestId,
    digest_date: dateIso,
    title: `Sloth Digest — ${dateIso}`,
    summary_markdown: markdown,
    threads_summarized: input.threadOutputs.length,
    emails_processed: allPersonalEmails.length + (bulkCountRow?.count || 0),
    newsletters_skipped: bulkCountRow?.count || 0,
    words_read: totalWordsIngested,
    read_time_saved_minutes: payoff.minutesSaved,
    created_at: new Date().toISOString(),
  });

  return {
    digestId,
    dateIso,
    markdownPath: `${config.storage.digestDir}/${dateIso}.md`,
    minutesSaved: payoff.minutesSaved,
  };
}

export async function deliverNotificationActivity(options: {
  dateIso: string;
  replyCount: number;
  minutesSaved: number;
  immediate?: boolean;
}): Promise<boolean> {
  const title = `🦥 Sloth Digest — ${options.replyCount > 0 ? `${options.replyCount} items need reply` : 'All clear'}`;
  const body = `Saved ~${Math.round(options.minutesSaved)} min of reading. Tap to review your executive digest.`;

  return await sendNtfyDigest({
    title,
    body,
    replyCount: options.replyCount,
    scheduledTime: config.ntfy.scheduleTime,
    immediate: options.immediate,
  });
}
