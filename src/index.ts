import { config } from './config.js';
import { createWebServer } from './deliver/server.js';
import { startWorker } from './temporal/worker.js';

console.log('🦥 Starting Sloth Digest unified service...');

// 1. Start LAN Dashboard
const server = createWebServer();
const port = config.storage.webPort;
server.listen(port, () => {
  console.log(`[web] Sloth Digest dashboard running at http://0.0.0.0:${port}/`);
});

// 2. Start Temporal Worker with reconnection backoff
async function connectWorkerWithRetry(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await startWorker();
      return;
    } catch (err) {
      console.warn(`[app] Waiting for Temporal server at ${config.temporal.address} (attempt ${attempt}/${maxAttempts}): ${(err as Error).message}`);
      if (attempt === maxAttempts) {
        console.error('[app] Maximum retry attempts reached. Worker did not start.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

connectWorkerWithRetry().catch((err) => {
  console.error('[app] Fatal worker error:', err);
});
