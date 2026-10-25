import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const {
  fetchNewEmailsActivity,
  classifyEmailsActivity,
  summarizeThreadActivity,
  reduceAndGenerateDigestActivity,
  deliverNotificationActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '15m',
  heartbeatTimeout: '1m',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '1m',
    maximumAttempts: 5,
  },
});

export interface WorkflowOptions {
  sinceHours?: number;
  immediateDelivery?: boolean;
  sampleThreads?: { threadId: string; subject: string }[];
}

export async function nightlyEmailDigestWorkflow(options: WorkflowOptions = {}): Promise<{
  digestId: string;
  threadsCount: number;
  minutesSaved: number;
}> {
  const hours = options.sinceHours || 24;
  const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // 1. Ingest new emails from Gmail
  await fetchNewEmailsActivity();

  // 2. Classify unclassified emails
  await classifyEmailsActivity();

  // 3. Summarize threads
  // Either use provided sample threads or fetch from SQLite through activities
  const targetThreads = options.sampleThreads || [
    { threadId: 'gm-demo-proposal', subject: 'Urgent: Project Proposal Review for Q4' },
    { threadId: 'gm-demo-lunch', subject: 'Team dinner & sprint retrospective plans' },
  ];

  const threadOutputs = [];
  for (const thread of targetThreads) {
    const output = await summarizeThreadActivity(thread);
    threadOutputs.push(output);
  }

  // 4. Reduce into overall digest & save markdown
  const digestResult = await reduceAndGenerateDigestActivity({
    threadOutputs,
    sinceIso: sinceDate,
  });

  // 5. Deliver push notification
  const pendingReplyCount = threadOutputs.filter((t) => t.hasNewAsk).length;
  await deliverNotificationActivity({
    dateIso: digestResult.dateIso,
    replyCount: pendingReplyCount,
    minutesSaved: digestResult.minutesSaved,
    immediate: options.immediateDelivery ?? true,
  });

  return {
    digestId: digestResult.digestId,
    threadsCount: threadOutputs.length,
    minutesSaved: digestResult.minutesSaved,
  };
}
