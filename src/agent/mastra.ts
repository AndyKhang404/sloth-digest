import { z } from 'zod';
import { llamaClient } from './llama.js';
import { EmailRecord } from '../db/index.js';

// ==========================================
// 1. Triage / Classification
// ==========================================

export const EmailCategorySchema = z.object({
  category: z.enum(['personal', 'transactional', 'bulk']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type EmailCategoryResult = z.infer<typeof EmailCategorySchema>;

export async function classifyEmailWithGemma(
  email: Pick<EmailRecord, 'from_addr' | 'subject' | 'body_cleaned' | 'raw_headers_json'>
): Promise<EmailCategoryResult> {
  const headerHints = email.raw_headers_json ? JSON.parse(email.raw_headers_json) : {};
  const preview = email.body_cleaned.slice(0, 300).replace(/\s+/g, ' ').trim();

  const prompt = `
You are a fast email triage classifier running locally.
Analyze this email and categorize it into strictly ONE of:
- "personal": direct 1-to-1 or group human communication requiring attention.
- "transactional": automated receipts, 2FA codes, account alerts, shipping notices.
- "bulk": newsletters, marketing, social digests, mailing lists.

Email Details:
From: ${email.from_addr}
Subject: ${email.subject}
Headers: List-Unsubscribe=${headerHints.listUnsubscribe ? 'yes' : 'no'}, Precedence=${headerHints.precedenceBulk ? 'bulk' : 'normal'}, NoReply=${headerHints.isNoReply ? 'yes' : 'no'}
Body snippet: "${preview}"

Return JSON matching:
{
  "category": "personal" | "transactional" | "bulk",
  "confidence": 0.0 to 1.0,
  "reason": "short explanation"
}
`.trim();

  const response = await llamaClient.completeJson<EmailCategoryResult>({
    messages: [
      { role: 'system', content: 'You are an email categorization assistant. Output strictly JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    maxTokens: 256,
  });

  const parsed = EmailCategorySchema.safeParse(response);
  if (!parsed.success) {
    // Default to personal if low confidence / unparsed, as per design decision #4
    return {
      category: 'personal',
      confidence: 0.5,
      reason: 'Fallback to personal: response schema parse mismatch',
    };
  }

  return parsed.data;
}

// ==========================================
// 2. Thread Summary & Reply Extraction
// ==========================================

export const ThreadSummarySchema = z.object({
  thread_summary: z.tuple([z.string(), z.string()]),
  needs_reply: z.boolean(),
  reply_reason: z.string().optional(),
  cited_message_ids: z.array(z.string()),
});

export type ThreadSummaryResult = z.infer<typeof ThreadSummarySchema>;

export async function summarizeThreadWithGemma(
  threadSubject: string,
  messages: EmailRecord[]
): Promise<ThreadSummaryResult> {
  const validMessageIds = new Set(messages.map((m) => m.message_id));

  const formattedMessages = messages
    .map(
      (m, idx) => `
[Message #${idx + 1}]
Message-ID: ${m.message_id}
From: ${m.from_addr}
Date: ${m.date}
Body:
${m.body_cleaned}
`
    )
    .join('\n---\n');

  const prompt = `
You are Gemma, an executive email digest assistant running locally overnight.
Summarize the following email thread into EXACTLY TWO concise lines.
Also determine if the thread contains an unanswered question, request, or action item directed to the user that "needs a reply".
If it needs a reply, you MUST cite the exact Message-ID where the ask is made.

Thread Subject: "${threadSubject}"
Messages (${messages.length}):
${formattedMessages}

Return JSON strictly matching this schema:
{
  "thread_summary": [
    "First line: clear concise summary of what was discussed",
    "Second line: outcome, current status, or next step"
  ],
  "needs_reply": true | false,
  "reply_reason": "Specific question or ask that requires user reply (if needs_reply is true)",
  "cited_message_ids": ["<message-id-where-ask-appeared>"]
}
`.trim();

  const response = await llamaClient.completeJson<ThreadSummaryResult>({
    messages: [
      {
        role: 'system',
        content: 'You are an executive summary agent. Output strictly valid JSON with exactly two summary lines.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    maxTokens: 512,
  });

  const parsed = ThreadSummarySchema.safeParse(response);
  const result = parsed.success
    ? parsed.data
    : {
        thread_summary: [
          `Discussion on: ${threadSubject}`,
          'Status logged overnight.',
        ] as [string, string],
        needs_reply: false,
        cited_message_ids: [],
      };

  // Deterministic validation: filter out any cited message IDs not actually in this thread
  const validatedCitations = result.cited_message_ids.filter((id) => validMessageIds.has(id));

  return {
    ...result,
    cited_message_ids: validatedCitations,
  };
}

// ==========================================
// 3. Overall Inbox Digest Overview
// ==========================================

export const InboxOverviewSchema = z.object({
  overview: z.tuple([z.string(), z.string()]),
});

export type InboxOverviewResult = z.infer<typeof InboxOverviewSchema>;

export async function generateOverallOverviewWithGemma(
  threadSummaries: { subject: string; summary: [string, string] }[],
  pendingReplyCount: number,
  newslettersSkipped: number
): Promise<InboxOverviewResult> {
  const threadLines = threadSummaries
    .map((t) => `- "${t.subject}": ${t.summary[0]} | ${t.summary[1]}`)
    .join('\n');

  const prompt = `
Synthesize an overall executive morning overview in EXACTLY TWO lines.
- Line 1: High-level mood/activity across all threads.
- Line 2: Immediate focus for the user today.

Stats:
- Active threads: ${threadSummaries.length}
- Pending items needing reply: ${pendingReplyCount}
- Low-priority bulk/newsletters skipped: ${newslettersSkipped}

Thread Summaries:
${threadLines}

Return JSON matching:
{
  "overview": [
    "Line 1 text...",
    "Line 2 text..."
  ]
}
`.trim();

  const response = await llamaClient.completeJson<InboxOverviewResult>({
    messages: [
      { role: 'system', content: 'You generate high-level two-line executive briefings. Return strictly JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 256,
  });

  const parsed = InboxOverviewSchema.safeParse(response);
  if (!parsed.success) {
    return {
      overview: [
        `Processed ${threadSummaries.length} active threads while you slept; skipped ${newslettersSkipped} newsletters.`,
        pendingReplyCount > 0
          ? `You have ${pendingReplyCount} priority items awaiting response today.`
          : 'Inbox is clean with zero pending reply debt.',
      ],
    };
  }

  return parsed.data;
}
