import { config } from '../config.js';

export interface NtfySendOptions {
  title: string;
  body: string;
  replyCount: number;
  scheduledTime?: string; // e.g. "07:00"
  immediate?: boolean;
}

export async function sendNtfyDigest(options: NtfySendOptions): Promise<boolean> {
  if (!config.ntfy.url) {
    console.log('[ntfy] NTFY_URL not configured, skipping push.');
    return false;
  }

  // ntfy supports UTF-8 encoded header using RFC 2047 format: =?utf-8?B?...?=
  const encodedTitle = '=?utf-8?B?' + Buffer.from(options.title, 'utf-8').toString('base64') + '?=';

  const headers: Record<string, string> = {
    Title: encodedTitle,
    Priority: options.replyCount > 0 ? '4' : '3',
    Tags: 'sloth,envelope,robot',
    Click: `${config.storage.dashboardUrl}/`,
  };

  // If scheduled delivery time is requested and not immediate
  if (!options.immediate && options.scheduledTime) {
    // ntfy supports "X-Schedule: 07:00" or natural language
    headers['X-Schedule'] = options.scheduledTime;
  }

  try {
    const res = await fetch(config.ntfy.url, {
      method: 'POST',
      headers,
      body: options.body,
    });

    if (res.ok) {
      console.log(`[ntfy] Successfully sent push notification to ${config.ntfy.url}`);
      return true;
    } else {
      console.warn(`[ntfy] Failed to post notification (HTTP ${res.status}): ${await res.text()}`);
      return false;
    }
  } catch (err) {
    console.warn(`[ntfy] Could not reach ntfy server at ${config.ntfy.url}:`, (err as Error).message);
    return false;
  }
}
