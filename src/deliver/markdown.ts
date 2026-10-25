import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { debtEngine, LazyPayoffMetric } from '../engine/debt.js';
import { ReplyDebtRecord } from '../db/index.js';

export interface DigestPayload {
  dateIso: string;
  overview: [string, string];
  threads: {
    threadId: string;
    subject: string;
    summary: [string, string];
    emailCount: number;
    hasNewAsk: boolean;
  }[];
  activeDebts: ReplyDebtRecord[];
  resolvedDebtsCount: number;
  newslettersSkipped: number;
  totalEmailsProcessed: number;
  payoff: LazyPayoffMetric;
}

export function generateDigestMarkdown(payload: DigestPayload): string {
  const formattedDebts = debtEngine.formatActiveDebtForDigest(payload.activeDebts);

  const lines: string[] = [];

  lines.push(`# 🦥 Sloth Digest — ${payload.dateIso}`);
  lines.push('');
  lines.push(`> **Executive Briefing**`);
  lines.push(`> 1. ${payload.overview[0]}`);
  lines.push(`> 2. ${payload.overview[1]}`);
  lines.push('');

  // 1. Reply Debt Section
  lines.push('## 🎯 Things You Need To Reply To');
  if (formattedDebts.length === 0) {
    lines.push('🎉 *No pending reply debt! Your inbox is fully up to date.*');
  } else {
    for (const debt of formattedDebts) {
      lines.push(`- **[${debt.badge}]** **${debt.subject}** (from \`${debt.from}\`)`);
      lines.push(`  - *Ask:* ${debt.ask}`);
      lines.push(`  - *ID:* \`${debt.id}\``);
    }
  }
  lines.push('');

  if (payload.resolvedDebtsCount > 0) {
    lines.push(`> 🧹 *Auto-cleared ${payload.resolvedDebtsCount} reply debt item(s) because your sent email resolved them.*`);
    lines.push('');
  }

  // 2. Thread Summaries Section
  lines.push('## 📬 Active Threads (2 Lines Per Thread)');
  if (payload.threads.length === 0) {
    lines.push('*No new personal conversations overnight.*');
  } else {
    for (const t of payload.threads) {
      lines.push(`### ✉️ ${t.subject} (${t.emailCount} message${t.emailCount > 1 ? 's' : ''})`);
      lines.push(`1. ${t.summary[0]}`);
      lines.push(`2. ${t.summary[1]}`);
      lines.push('');
    }
  }

  // 3. Low-Priority Bulk Mail
  lines.push('## 🔕 Filtered Bulk & Newsletters');
  lines.push(`Quietly skipped **${payload.newslettersSkipped}** bulk newsletters and marketing updates overnight.`);
  lines.push('');

  // 4. Lazy Payoff Metrics
  lines.push('## ⏱️ The Lazy Payoff');
  lines.push(`- **Emails digested:** ${payload.totalEmailsProcessed}`);
  lines.push(`- **Words digested:** ${payload.payoff.totalWordsIngested.toLocaleString()} raw words → ${payload.payoff.digestWords} digest words`);
  lines.push(`- **Reading time saved:** **${payload.payoff.hoursSavedDisplay}** (assuming 238 words/min average reading speed)`);
  lines.push('');
  lines.push('---');
  lines.push('*Generated locally overnight by Gemma 4B on llama.cpp, Mastra & Temporal. No messages ever left your network.*');

  const markdown = lines.join('\n');

  // Save to disk
  if (!fs.existsSync(config.storage.digestDir)) {
    fs.mkdirSync(config.storage.digestDir, { recursive: true, mode: 0o700 });
  }

  const filePath = path.join(config.storage.digestDir, `${payload.dateIso}.md`);
  fs.writeFileSync(filePath, markdown, { encoding: 'utf-8', mode: 0o600 });

  // Also write latest.md for quick access
  const latestPath = path.join(config.storage.digestDir, 'latest.md');
  fs.writeFileSync(latestPath, markdown, { encoding: 'utf-8', mode: 0o600 });

  return markdown;
}
