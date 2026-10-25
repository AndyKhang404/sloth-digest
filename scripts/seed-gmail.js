import { createImapClient } from '../src/ingest/imap.js';
import { dbService } from '../src/db/index.js';
import { cleanEmailBody } from '../src/ingest/cleaner.js';
import { config } from '../src/config.js';
const SEED_DATA = [
    // 1. Thread 1: Urgent Proposal Review (Planted Ask - Needs Reply)
    {
        threadId: 'gm-demo-proposal',
        messageId: '<ask-proposal-01@company.internal>',
        mailbox: 'INBOX',
        subject: 'Urgent: Project Proposal Review for Q4',
        from: 'Sarah Chen <sarah.chen@techcorp.io>',
        to: config.gmail.user || 'you@local.dev',
        date: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        headers: {
            'x-gm-thrid': '1823901238910',
        },
        body: `Hi team,

I have finalized the draft for the Q4 distributed agent architecture proposal.
We need your feedback on Section 3 (Temporal workflow durability & worker failover) before we present to leadership tomorrow at 9 AM.

Could you please review the attached summary and let me know if you approve the proposed timeout strategy?

Thanks,
Sarah
--
Principal Systems Architect`,
    },
    // 2. Thread 2: Thread where user ALREADY replied in Sent (Should Auto-Resolve Debt!)
    {
        threadId: 'gm-demo-replied',
        messageId: '<ask-db-migration-01@company.internal>',
        mailbox: 'INBOX',
        subject: 'Database schema migration schedule',
        from: 'Alex Rivera <alex.r@techcorp.io>',
        to: config.gmail.user || 'you@local.dev',
        date: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        headers: {
            'x-gm-thrid': '1823904445551',
        },
        body: `Hey,

Are we still good to run the SQLite WAL migration tonight at midnight?
Let me know if you need me to stand by for backup verification.

Alex`,
    },
    {
        threadId: 'gm-demo-replied',
        messageId: '<reply-db-migration-02@company.internal>',
        mailbox: 'SENT',
        subject: 'Re: Database schema migration schedule',
        from: config.gmail.user || 'you@local.dev',
        to: 'Alex Rivera <alex.r@techcorp.io>',
        date: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
        headers: {
            'x-gm-thrid': '1823904445551',
            'in-reply-to': '<ask-db-migration-01@company.internal>',
            references: '<ask-db-migration-01@company.internal>',
        },
        body: `Hi Alex,

Yes, we are all set for midnight. WAL mode is already enabled in production staging. No need to stay up late, I will monitor the Temporal logs.

Cheers!`,
    },
    // 3. Thread 3: Bulk Newsletter (Should be classified as bulk and skipped)
    {
        threadId: 'gm-demo-newsletter',
        messageId: '<newsletter-oct26@digest.aimonthly.net>',
        mailbox: 'INBOX',
        subject: 'AI Systems Weekly #42: Open-Weight Models in Production',
        from: 'AI Systems Weekly <newsletter@aimonthly.net>',
        to: config.gmail.user || 'subscribers@aimonthly.net',
        date: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
        headers: {
            'list-unsubscribe': '<mailto:unsubscribe@aimonthly.net>, <https://aimonthly.net/unsub>',
            precedence: 'bulk',
        },
        body: `AI Systems Weekly — Issue #42

Welcome to this week's edition. Today we look at running quantized Gemma models locally on edge devices, CPU inference benchmarks with llama.cpp, and durability patterns using Temporal workflows.

Sponsored: Try our new cloud GPU hosting today with 50% discount. Click here to claim your credit.

To unsubscribe from this list, click the link below:
https://aimonthly.net/unsub`,
    },
    // 4. Thread 4: Transactional Alert
    {
        threadId: 'gm-demo-transactional',
        messageId: '<alert-git-9988@github.internal>',
        mailbox: 'INBOX',
        subject: '[GitHub] Dependabot alert for dev-week3',
        from: 'GitHub Notifications <notifications@github.com>',
        to: config.gmail.user || 'you@local.dev',
        date: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
        headers: {
            precedence: 'list',
            'x-github-severity': 'moderate',
        },
        body: `GitHub Dependabot Alert:

A new dependency vulnerability was detected in your dependency tree.
Repository: dev-week3
Package: example-pkg
Severity: Low

No immediate manual intervention is required. Review the pull request at https://github.com/repo/pulls/1.`,
    },
    // 5. Thread 5: Friendly personal email with weekend hackathon question
    {
        threadId: 'gm-demo-lunch',
        messageId: '<lunch-hackathon-77@friends.org>',
        mailbox: 'INBOX',
        subject: 'Team dinner & sprint retrospective plans',
        from: 'David Nguyen <david.nguyen@friends.org>',
        to: config.gmail.user || 'you@local.dev',
        date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        headers: {
            'x-gm-thrid': '1823908889992',
        },
        body: `Hey!

Great progress on the Hacktoberfest project this weekend!
Are you free to grab dinner around 7 PM on Wednesday to celebrate wrapping up the Week 3 submission?
Let me know if that time works for you or if Thursday is better.

David`,
    },
];
async function seedLocalDatabase() {
    console.log('[seed] Seeding synthetic demonstration dataset into local SQLite database...');
    let count = 0;
    for (const item of SEED_DATA) {
        const cleaned = cleanEmailBody(item.body);
        const emailRecord = {
            message_id: item.messageId,
            account_id: config.gmail.user || 'local-user',
            thread_id: item.threadId,
            mailbox: item.mailbox,
            uid: Math.floor(Math.random() * 10000) + 1,
            from_addr: item.from,
            to_addr: item.to || null,
            subject: item.subject,
            date: item.date,
            body_cleaned: cleaned.text,
            raw_headers_json: JSON.stringify(item.headers || {}),
            category: null,
            confidence: null,
        };
        dbService.saveEmail(emailRecord);
        count++;
    }
    // Pre-seed the Sent reply into debt reconciliation
    const sentReply = SEED_DATA.find((m) => m.mailbox === 'SENT');
    if (sentReply) {
        // If there was an open debt on that thread, resolve it
        dbService.resolveReplyDebtByThread(sentReply.threadId, sentReply.messageId);
    }
    console.log(`[seed] Successfully seeded ${count} synthetic messages into SQLite.`);
}
async function seedRemoteGmailImap() {
    if (!config.gmail.user || !config.gmail.appPassword) {
        console.log('[seed] GMAIL_USER / GMAIL_APP_PASSWORD not set. Falling back to local SQLite seed.');
        await seedLocalDatabase();
        return;
    }
    console.log(`[seed] Connecting to Gmail IMAP as ${config.gmail.user} to APPEND synthetic messages...`);
    const client = createImapClient();
    try {
        await client.connect();
        for (const item of SEED_DATA) {
            const destination = item.mailbox === 'SENT' ? '[Gmail]/Sent Mail' : 'INBOX';
            console.log(`[seed] Appending "${item.subject}" to ${destination}...`);
            const rawHeaders = [
                `From: ${item.from}`,
                `To: ${item.to}`,
                `Subject: ${item.subject}`,
                `Date: ${new Date(item.date).toUTCString()}`,
                `Message-ID: ${item.messageId}`,
            ];
            if (item.headers) {
                for (const [k, v] of Object.entries(item.headers)) {
                    rawHeaders.push(`${k}: ${v}`);
                }
            }
            const rawMessage = `${rawHeaders.join('\r\n')}\r\n\r\n${item.body}`;
            await client.append(destination, Buffer.from(rawMessage), ['\\Seen'], new Date(item.date));
        }
        console.log('[seed] Successfully appended all demo messages to Gmail account!');
    }
    catch (err) {
        console.warn('[seed] IMAP APPEND failed:', err.message);
        console.log('[seed] Falling back to local database seed...');
        await seedLocalDatabase();
    }
    finally {
        await client.logout().catch(() => { });
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--local') || !config.gmail.appPassword) {
        await seedLocalDatabase();
    }
    else {
        await seedRemoteGmailImap();
    }
}
main().catch(console.error);
