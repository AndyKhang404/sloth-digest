import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Load .env if present
dotenv.config();

function readSecretOrEnv(envVar: string, fileEnvVar?: string, defaultValue = ''): string {
  if (fileEnvVar && process.env[fileEnvVar]) {
    const filePath = process.env[fileEnvVar]!;
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
  }
  return process.env[envVar] || defaultValue;
}

export interface AppConfig {
  gmail: {
    user: string;
    appPassword: string;
    host: string;
    port: number;
    secure: boolean;
  };
  llama: {
    serverUrl: string;
    modelName: string;
    timeoutMs: number;
  };
  temporal: {
    address: string;
    namespace: string;
    taskQueue: string;
    scheduleHour: number;
    scheduleMinute: number;
  };
  ntfy: {
    url: string;
    scheduleTime: string; // e.g. "07:00"
  };
  storage: {
    dbPath: string;
    digestDir: string;
    webPort: number;
    webAuthToken: string;
  };
}

export function loadConfig(): AppConfig {
  const user = process.env.GMAIL_USER || '';
  const appPassword = readSecretOrEnv('GMAIL_APP_PASSWORD', 'GMAIL_APP_PASSWORD_FILE');
  const webAuthToken = readSecretOrEnv('WEB_AUTH_TOKEN', 'WEB_AUTH_TOKEN_FILE');

  const serverUrl = (process.env.LLAMA_SERVER_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const modelName = process.env.LLAMA_MODEL_NAME || 'gemma-2-4b-it';

  const dbPath = path.resolve(process.env.SQLITE_DB_PATH || './data/sloth.db');
  const digestDir = path.resolve(process.env.DIGEST_OUTPUT_DIR || './data/digests');

  return {
    gmail: {
      user,
      appPassword,
      host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
      port: Number(process.env.GMAIL_IMAP_PORT) || 993,
      secure: true,
    },
    llama: {
      serverUrl,
      modelName,
      timeoutMs: Number(process.env.LLAMA_TIMEOUT_MS) || 120_000,
    },
    temporal: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'sloth-digest',
      scheduleHour: Number(process.env.DIGEST_SCHEDULE_HOUR) || 6,
      scheduleMinute: Number(process.env.DIGEST_SCHEDULE_MINUTE) || 0,
    },
    ntfy: {
      url: process.env.NTFY_URL || 'http://localhost:8088/sloth-digest',
      scheduleTime: process.env.NTFY_SCHEDULE_TIME || '07:00',
    },
    storage: {
      dbPath,
      digestDir,
      webPort: Number(process.env.WEB_PORT) || 3000,
      webAuthToken,
    },
  };
}

export const config = loadConfig();
