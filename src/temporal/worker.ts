import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.js';
import { config } from '../config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runWorker() {
  console.log(`[worker] Connecting to Temporal server at ${config.temporal.address}...`);

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });

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

runWorker().catch((err) => {
  console.error('[worker] Worker encountered a fatal error:', err);
  process.exit(1);
});
