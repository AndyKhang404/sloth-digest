import { Connection, Client, ScheduleAlreadyRunning } from '@temporalio/client';
import { config } from './config.js';
import { dbService } from './db/index.js';
import { createWebServer } from './deliver/server.js';
import { debtEngine } from './engine/debt.js';
import {
  fetchNewEmailsActivity,
  classifyEmailsActivity,
  summarizeThreadActivity,
  reduceAndGenerateDigestActivity,
  deliverNotificationActivity,
} from './temporal/activities.js';

async function runDirectPipeline() {
  console.log('\n🦥 [sloth-digest] Starting standalone local execution...\n');

  // 1. Ingest (or read local seeded database if IMAP not configured)
  console.log('==> Step 1: Ingesting emails...');
  try {
    const ingest = await fetchNewEmailsActivity();
    console.log(`    Inbox fetched: ${ingest.inboxFetched}, Sent fetched: ${ingest.sentFetched}`);
  } catch (e) {
    console.log(`    (IMAP fetch note: ${(e as Error).message}. Reading existing emails from local database.)`);
  }

  // 2. Classify unclassified emails
  console.log('\n==> Step 2: Running Gemma triage classifier...');
  const triage = await classifyEmailsActivity();
  console.log(`    Classified: ${triage.classifiedCount} total (Personal: ${triage.personalCount}, Bulk: ${triage.bulkCount}, Transactional: ${triage.transactionalCount})`);

  // 3. Summarize personal threads
  console.log('\n==> Step 3: Summarizing personal threads...');
  const threads = dbService.getPersonalThreadsSince(new Date(Date.now() - 48 * 3600 * 1000).toISOString());
  const threadOutputs = [];

  for (const t of threads) {
    console.log(`    - Processing thread: "${t.subject}"...`);
    const out = await summarizeThreadActivity({
      threadId: t.thread_id,
      subject: t.subject,
    });
    console.log(`      Line 1: ${out.summary[0]}`);
    console.log(`      Line 2: ${out.summary[1]}`);
    if (out.hasNewAsk) {
      console.log(`      [!] Action Item Detected -> Added to Reply Debt`);
    }
    threadOutputs.push(out);
  }

  // 4. Reduce into overall digest & markdown
  console.log('\n==> Step 4: Synthesizing overall executive digest...');
  const digestResult = await reduceAndGenerateDigestActivity({
    threadOutputs,
    sinceIso: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  });
  console.log(`    Digest written to: ${digestResult.markdownPath}`);
  console.log(`    Reading time saved: ~${Math.round(digestResult.minutesSaved)} minutes`);

  // 5. Delivery
  console.log('\n==> Step 5: Delivering morning notification...');
  const pendingDebt = dbService.getOpenReplyDebt().length;
  await deliverNotificationActivity({
    dateIso: digestResult.dateIso,
    replyCount: pendingDebt,
    minutesSaved: digestResult.minutesSaved,
    immediate: true,
  });

  console.log('\n✅ [sloth-digest] Pipeline finished successfully!\n');
}

async function triggerTemporalWorkflow() {
  console.log(`Connecting to Temporal server at ${config.temporal.address}...`);
  try {
    const connection = await Connection.connect({ address: config.temporal.address });
    const client = new Client({ connection, namespace: config.temporal.namespace });

    const handle = await client.workflow.start('nightlyEmailDigestWorkflow', {
      taskQueue: config.temporal.taskQueue,
      workflowId: `sloth-digest-${Date.now()}`,
      args: [{ immediateDelivery: true }],
    });

    console.log(`Started Temporal workflow with ID: ${handle.workflowId}`);
    console.log(`Waiting for workflow execution result...`);
    const result = await handle.result();
    console.log(`Workflow completed! Digest ID:`, result);
  } catch (err) {
    console.warn(`[temporal] Could not connect to Temporal server (${(err as Error).message}).`);
    console.log(`Falling back to direct local pipeline execution:`);
    await runDirectPipeline();
  }
}

async function setupTemporalSchedule() {
  console.log(`Configuring 03:00 AM nightly Temporal schedule at ${config.temporal.address}...`);
  try {
    const connection = await Connection.connect({ address: config.temporal.address });
    const client = new Client({ connection, namespace: config.temporal.namespace });

    const scheduleId = 'sloth-nightly-digest-schedule';
    try {
      await client.schedule.create({
        scheduleId,
        spec: {
          calendars: [{ hour: 3, minute: 0 }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'nightlyEmailDigestWorkflow',
          taskQueue: config.temporal.taskQueue,
          args: [{ immediateDelivery: false, sinceHours: 24 }],
        },
        policies: {
          catchupWindow: '4h', // If the homelab was asleep or rebooting, catch up within 4 hours
        },
      });
      console.log(`✅ Schedule '${scheduleId}' registered to run every night at 03:00.`);
    } catch (e) {
      if (e instanceof ScheduleAlreadyRunning) {
        console.log(`Schedule '${scheduleId}' already exists and is active.`);
      } else {
        throw e;
      }
    }
  } catch (err) {
    console.error(`[temporal] Failed to configure schedule: ${(err as Error).message}`);
  }
}

function listDebt() {
  const debts = dbService.getOpenReplyDebt();
  console.log('\n=== 🎯 Active Reply Debt ===\n');
  if (debts.length === 0) {
    console.log('No open reply debt! All caught up.');
  } else {
    for (const d of debts) {
      console.log(`[${d.id}] "${d.subject}" from ${d.from_addr}`);
      console.log(`       Ask: ${d.ask_summary}`);
      console.log(`       Detected: ${d.detected_at}\n`);
    }
  }
}

function dismissDebt(id: string) {
  if (!id) {
    console.error('Usage: sloth dismiss <id>');
    return;
  }
  const ok = dbService.dismissReplyDebt(id);
  if (ok) {
    console.log(`✅ Dismissed reply debt item: ${id}`);
  } else {
    console.log(`❌ Could not find open debt item with ID: ${id}`);
  }
}

async function main() {
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'run':
    case 'run-now':
      await triggerTemporalWorkflow();
      break;

    case 'run-local':
      await runDirectPipeline();
      break;

    case 'schedule':
      await setupTemporalSchedule();
      break;

    case 'debt':
      listDebt();
      break;

    case 'dismiss':
      dismissDebt(process.argv[3]);
      break;

    case 'serve': {
      const server = createWebServer();
      const port = config.storage.webPort;
      server.listen(port, () => {
        console.log(`[web] Sloth Digest dashboard running at http://localhost:${port}/`);
      });
      break;
    }

    case 'help':
    default:
      console.log(`
🦥 Sloth Digest — Private Overnight Gmail Digest
Commands:
  npm run sloth -- run-now    Trigger digest workflow immediately
  npm run sloth -- run-local  Run standalone local pipeline without external Temporal server
  npm run sloth -- schedule   Register 03:00 AM nightly Temporal schedule
  npm run sloth -- debt       List current pending reply debt items
  npm run sloth -- dismiss ID Manually dismiss a reply debt item
  npm run sloth -- serve      Launch LAN web dashboard (port ${config.storage.webPort})
  npm run seed                Seed synthetic demonstration emails into database
      `);
      break;
  }
}

main().catch(console.error);
