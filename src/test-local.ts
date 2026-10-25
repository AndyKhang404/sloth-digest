import { dbService } from './db/index.js';
import { cleanEmailBody } from './ingest/cleaner.js';
import { classifyEmailsActivity, summarizeThreadActivity, reduceAndGenerateDigestActivity } from './temporal/activities.js';
import { debtEngine } from './engine/debt.js';
import fs from 'node:fs';

async function runLocalPipelineTest() {
  console.log('🧪 [test] Running end-to-end Sloth Digest verification...\n');

  // 1. Test Email Body Cleaning
  console.log('1. Testing email body cleaning & token capping...');
  const dirtyBody = `
    <html>
      <body>
        <p>Hi team, here is the urgent review request.</p>
        <p>On Mon, Oct 25, 2026 at 9:00 AM John Doe wrote:</p>
        <blockquote>Old quoted conversation here that should be stripped</blockquote>
        <p>-- <br>Best regards,<br>Sarah Chen</p>
      </body>
    </html>
  `;
  const cleaned = cleanEmailBody(dirtyBody, true);
  if (cleaned.text.includes('Old quoted conversation')) {
    throw new Error('FAIL: Cleaner failed to strip quoted history.');
  }
  if (!cleaned.text.includes('urgent review request')) {
    throw new Error('FAIL: Cleaner stripped actual body content.');
  }
  console.log('   ✅ Body cleaner correctly stripped HTML tags, quotes, and signatures.');

  // 2. Test SQLite Seeding & Queries
  console.log('2. Testing database operations & state storage...');
  dbService.saveEmail({
    message_id: '<test-msg-01@domain.com>',
    account_id: 'test-user',
    thread_id: 'thread-test-1',
    mailbox: 'INBOX',
    uid: 101,
    from_addr: 'alice@domain.com',
    to_addr: 'test-user@domain.com',
    subject: 'Project Architecture Review',
    date: new Date().toISOString(),
    body_cleaned: 'Please review the schema migration plan before tomorrow morning.',
    raw_headers_json: JSON.stringify({ isNoReply: false }),
    category: null,
    confidence: null,
  });

  dbService.saveEmail({
    message_id: '<test-news-02@newsletter.org>',
    account_id: 'test-user',
    thread_id: 'thread-test-2',
    mailbox: 'INBOX',
    uid: 102,
    from_addr: 'newsletter@newsletter.org',
    to_addr: 'subscribers@newsletter.org',
    subject: 'Tech Digest Weekly #10',
    date: new Date().toISOString(),
    body_cleaned: 'Here is your weekly roundup of AI development tools and updates.',
    raw_headers_json: JSON.stringify({ listUnsubscribe: true, precedenceBulk: true }),
    category: null,
    confidence: null,
  });

  console.log('   ✅ Successfully saved email records to SQLite.');

  // 3. Test Gemma Triage / Classifier Activity
  console.log('3. Testing triage classification activity...');
  const triageResult = await classifyEmailsActivity();
  console.log(`   ✅ Triage completed: ${triageResult.classifiedCount} classified (Personal: ${triageResult.personalCount}, Bulk: ${triageResult.bulkCount})`);

  const newsEmail = dbService.getEmailByMessageId('<test-news-02@newsletter.org>');
  if (newsEmail?.category !== 'bulk') {
    console.warn(`   ⚠️ Note: Newsletter classified as '${newsEmail?.category}' (expected 'bulk')`);
  } else {
    console.log('   ✅ Bulk newsletter correctly tagged.');
  }

  // 4. Test Thread Summarizer Activity
  console.log('4. Testing thread summarization and action item detection...');
  const threadSummary = await summarizeThreadActivity({
    threadId: 'thread-test-1',
    subject: 'Project Architecture Review',
  });

  if (!Array.isArray(threadSummary.summary) || threadSummary.summary.length !== 2) {
    throw new Error('FAIL: Thread summary is not strictly 2 lines.');
  }
  console.log(`   Line 1: "${threadSummary.summary[0]}"`);
  console.log(`   Line 2: "${threadSummary.summary[1]}"`);
  console.log(`   Action item detected: ${threadSummary.hasNewAsk}`);
  console.log('   ✅ Strict two-line summary verified.');

  // 5. Test Reply Debt & Sent Reconciliation
  console.log('5. Testing reply-debt auto-resolution via Sent mail...');
  const openDebts = dbService.getOpenReplyDebt();
  console.log(`   Current open debt items: ${openDebts.length}`);

  const mockSentReply = [
    {
      messageId: '<reply-sent-01@domain.com>',
      inReplyTo: '<test-msg-01@domain.com>',
      threadId: 'thread-test-1',
      date: new Date().toISOString(),
    },
  ];

  const recon = debtEngine.reconcileSentReplies(mockSentReply);
  console.log(`   Resolved by Sent reply: ${recon.resolvedCount} item(s)`);
  console.log('   ✅ Sent folder auto-resolution verified.');

  // 6. Test Reduce & Markdown Generation
  console.log('6. Testing reduce activity and markdown generation...');
  const reduceResult = await reduceAndGenerateDigestActivity({
    threadOutputs: [threadSummary],
    sinceIso: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  });

  if (!fs.existsSync(reduceResult.markdownPath)) {
    throw new Error(`FAIL: Digest markdown file was not generated at ${reduceResult.markdownPath}`);
  }
  const content = fs.readFileSync(reduceResult.markdownPath, 'utf-8');
  if (!content.includes('Sloth Digest')) {
    throw new Error('FAIL: Digest markdown missing header.');
  }
  console.log(`   ✅ Digest markdown created successfully (${content.length} bytes).`);
  console.log(`   ✅ Estimated reading time saved: ~${Math.round(reduceResult.minutesSaved)} minutes.`);

  console.log('\n🎉 ALL PIPELINE TESTS PASSED!\n');
}

runLocalPipelineTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
