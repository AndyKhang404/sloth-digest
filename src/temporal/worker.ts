import { Worker, NativeConnection } from '@temporalio/worker';
import { Connection, Client, ScheduleAlreadyRunning } from '@temporalio/client';
import * as activities from './activities.js';
import { config } from '../config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DIGEST_SCHEDULE_ID = 'sloth-nightly-digest-schedule';

export async function ensureTemporalSchedule(): Promise<void> {
  const hour = config.temporal.scheduleHour;
  const minute = config.temporal.scheduleMinute;
  const timezone = config.temporal.timezone;
  const timeDisplay = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  console.log(`[schedule] Ensuring ${timeDisplay} (${timezone}) schedule at ${config.temporal.address}...`);

  const clientConn = await Connection.connect({ address: config.temporal.address });
  try {
    const client = new Client({ connection: clientConn, namespace: config.temporal.namespace });

    let handle = client.schedule.getHandle(DIGEST_SCHEDULE_ID);
    try {
      handle = await client.schedule.create({
        scheduleId: DIGEST_SCHEDULE_ID,
        spec: {
          calendars: [{ hour, minute }],
          timezone,
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
      console.log(`✅ [schedule] Registered '${DIGEST_SCHEDULE_ID}' for ${timeDisplay} (${timezone}).`);
    } catch (e) {
      if (e instanceof ScheduleAlreadyRunning) {
        await handle.update((prev) => ({
          ...prev,
          spec: {
            calendars: [{ hour, minute }],
            timezone,
          },
          action: {
            type: 'startWorkflow',
            workflowType: 'nightlyEmailDigestWorkflow',
            taskQueue: config.temporal.taskQueue,
            args: [{ immediateDelivery: false, sinceHours: 24 }],
          },
          policies: {
            ...prev.policies,
            catchupWindow: '4h',
          },
        }));
        console.log(`✅ [schedule] Updated existing '${DIGEST_SCHEDULE_ID}' to ${timeDisplay} (${timezone}).`);
      } else {
        throw e;
      }
    }

    const desc = await handle.describe();
    const nextRun = desc.info.nextActionTimes[0];
    if (nextRun) {
      console.log(`[schedule] Next scheduled workflow execution: ${nextRun.toISOString()}`);
    }

    // If the schedule was just registered or timezone-corrected within the 4-hour catch-up window
    // after today's scheduled time and hasn't run today, trigger the catch-up run immediately.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date());
    const currentHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const currentMinute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const elapsedMinutesToday = currentHour * 60 + currentMinute - (hour * 60 + minute);

    const recentActions = desc.info.recentActions || [];
    const lastAction = recentActions[recentActions.length - 1];
    const ranRecently =
      lastAction?.takenAt && Date.now() - new Date(lastAction.takenAt).getTime() < 12 * 3600 * 1000;
    const isRunningNow = (desc.info.runningActions || []).length > 0;

    if (elapsedMinutesToday >= 0 && elapsedMinutesToday <= 240 && !ranRecently && !isRunningNow) {
      console.log(
        `[schedule] Today's ${timeDisplay} (${timezone}) window passed ${elapsedMinutesToday}m ago with no run — triggering catch-up workflow now!`
      );
      await handle.trigger();
    }
  } finally {
    await clientConn.close();
  }
}

export async function startWorker() {
  console.log(`[worker] Connecting to Temporal server at ${config.temporal.address}...`);

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });

  try {
    await ensureTemporalSchedule();
  } catch (err) {
    console.warn(`[worker] Could not auto-configure schedule: ${(err as Error).message}`);
  }

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: path.resolve(__dirname, './workflows.js'),
    activities,
    // Concurrency tuned to 1 for CPU-friendly Gemma model execution
    maxConcurrentActivityTaskExecutions: 1,
  });

  console.log(`[worker] Sloth Digest Temporal worker started on queue: "${config.temporal.taskQueue}"`);
  console.log(`[worker] Concurrency limit: 1 (CPU-optimized for Gemma on llama.cpp)`);

  await worker.run();
}

if (process.argv[1] && /worker\.(js|ts)$/.test(process.argv[1])) {
  startWorker().catch((err) => {
    console.error('[worker] Worker encountered a fatal error:', err);
    process.exit(1);
  });
}

