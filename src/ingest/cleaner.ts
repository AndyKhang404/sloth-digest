import { convert } from 'html-to-text';

export interface CleanedEmailBody {
  text: string;
  wordCount: number;
  preview300: string;
  hasQuotedHistory: boolean;
  attachmentNames: string[];
}

export function cleanEmailBody(
  rawHtmlOrText: string,
  isHtml = false,
  attachments: { filename?: string }[] = []
): CleanedEmailBody {
  // Cap raw input at 200 KB before processing to avoid parsing multi-megabyte MIME payloads
  const MAX_RAW_INPUT = 200_000;
  let plain = (rawHtmlOrText || '').slice(0, MAX_RAW_INPUT).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
    ''
  );

  // Strip raw MIME part headers and long base64-encoded blocks if present
  plain = plain
    .replace(/^--[^\r\n]+$/gm, '')
    .replace(/^Content-(Type|Transfer-Encoding|Disposition|ID):[^\r\n]*(\r?\n[ \t]+[^\r\n]*)*/gim, '')
    .replace(/(?:^[A-Za-z0-9+/=]{60,}\r?\n){3,}/gm, '[binary attachment omitted]\n');

  // 1. Convert HTML to clean text if necessary
  if (isHtml || /<[a-z][\s\S]*>/i.test(plain)) {
    plain = convert(plain, {
      wordwrap: false,
      limits: {
        maxInputLength: MAX_RAW_INPUT,
      },
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
  }

  // 2. Strip quoted reply history
  const originalLength = plain.length;
  // Patterns like:
  // "On Mon, Oct 25, 2026 at 10:00 AM John Doe <john@example.com> wrote:"
  // "> quoted text"
  // "-----Original Message-----"
  const lines = plain.split(/\r?\n/);
  const filteredLines: string[] = [];
  let skippingQuotes = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for quote boundary
    if (
      /^On\s+.+wrote:$/i.test(trimmed) ||
      /^-----Original Message-----/i.test(trimmed) ||
      /^From:\s+.+Sent:\s+/i.test(trimmed)
    ) {
      skippingQuotes = true;
      continue;
    }

    if (skippingQuotes) {
      // If the line starts with quote char '>', skip it
      if (trimmed.startsWith('>')) continue;
      // If we see significant unquoted content later, we might resume, or stop
    }

    if (trimmed.startsWith('>')) {
      continue;
    }

    // Check for signature markers
    if (trimmed === '--' || trimmed === '-- ') {
      // Standard signature delimiter
      break;
    }

    filteredLines.push(line);
  }

  let cleanedText = filteredLines.join('\n').trim();

  // Compress multiple blank lines
  cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');

  // 3. Attachment listing
  const attachmentNames = attachments
    .map((a) => a.filename)
    .filter((f): f is string => Boolean(f));

  if (attachmentNames.length > 0) {
    cleanedText += `\n\n[Attachments: ${attachmentNames.join(', ')}]`;
  }

  // 4. Cap length to ~1.5k tokens (~6,000 characters)
  const MAX_CHARS = 6000;
  if (cleanedText.length > MAX_CHARS) {
    cleanedText = cleanedText.slice(0, MAX_CHARS) + '\n... [truncated for local processing]';
  }

  // Word count (split by whitespace)
  const words = cleanedText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // First 300 characters for classifier triage
  const preview300 = cleanedText.slice(0, 300).replace(/\s+/g, ' ').trim();

  return {
    text: cleanedText,
    wordCount,
    preview300,
    hasQuotedHistory: originalLength > cleanedText.length + 50,
    attachmentNames,
  };
}
