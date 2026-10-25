import { dbService, ReplyDebtRecord } from '../db/index.js';

export interface LazyPayoffMetric {
  totalWordsIngested: number;
  digestWords: number;
  readingSpeedWpm: number;
  minutesSaved: number;
  hoursSavedDisplay: string;
}

export const debtEngine = {
  /**
   * Reconcile Sent replies against open reply debt items.
   * If a sent message's In-Reply-To or thread ID matches an open debt item, resolve it.
   */
  reconcileSentReplies(
    sentReplies: {
      messageId: string;
      inReplyTo?: string;
      threadId: string;
      date: string;
    }[]
  ): { resolvedCount: number; resolvedItems: string[] } {
    let resolvedCount = 0;
    const resolvedItems: string[] = [];

    const openDebts = dbService.getOpenReplyDebt();
    if (openDebts.length === 0 || sentReplies.length === 0) {
      return { resolvedCount: 0, resolvedItems: [] };
    }

    const normalizeMsgId = (id: string) => id.trim().replace(/^<+|>+$/g, '');

    for (const reply of sentReplies) {
      const normalizedReplyTarget = reply.inReplyTo ? normalizeMsgId(reply.inReplyTo) : '';

      for (const debt of openDebts) {
        if (debt.status !== 'open') continue;

        // Match by exact normalized inReplyTo Message-ID or threadId
        const normalizedDebtMsgId = normalizeMsgId(debt.message_id);
        const matchesInReplyTo =
          Boolean(normalizedReplyTarget) &&
           Boolean(normalizedDebtMsgId) &&
          normalizedReplyTarget === normalizedDebtMsgId;
        const matchesThread = reply.threadId === debt.thread_id;

        if (matchesInReplyTo || matchesThread) {
          const changed = dbService.resolveReplyDebtByThread(debt.thread_id, reply.messageId);
          if (changed > 0) {
            resolvedCount += changed;
            resolvedItems.push(`Resolved ask: "${debt.subject}" via sent message ${reply.messageId}`);
            debt.status = 'resolved';
          }
        }
      }
    }

    return { resolvedCount, resolvedItems };
  },

  /**
   * Calculate time saved using scientific 238 words per minute reading benchmark.
   */
  calculateLazyPayoff(totalWordsIngested: number, digestWords: number): LazyPayoffMetric {
    const WPM = 238;
    const minutesToReadSource = totalWordsIngested / WPM;
    const minutesToReadDigest = digestWords / WPM;
    const minutesSaved = Math.max(0, Math.round((minutesToReadSource - minutesToReadDigest) * 10) / 10);

    const hours = Math.floor(minutesSaved / 60);
    const mins = Math.round(minutesSaved % 60);
    const hoursSavedDisplay = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;

    return {
      totalWordsIngested,
      digestWords,
      readingSpeedWpm: WPM,
      minutesSaved,
      hoursSavedDisplay,
    };
  },

  /**
   * Format debt items for the digest with age indicators.
   */
  formatActiveDebtForDigest(debts: ReplyDebtRecord[]): {
    id: string;
    subject: string;
    from: string;
    ask: string;
    ageDays: number;
    badge: string;
  }[] {
    const now = Date.now();
    return debts.map((d) => {
      const detected = new Date(d.detected_at).getTime();
      const ageDays = Math.floor((now - detected) / (1000 * 60 * 60 * 24));
      const badge = ageDays === 0 ? 'NEW' : `PENDING ${ageDays}d`;
      return {
        id: d.id,
        subject: d.subject,
        from: d.from_addr,
        ask: d.ask_summary,
        ageDays,
        badge,
      };
    });
  },
};
