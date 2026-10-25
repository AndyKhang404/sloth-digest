# 🦥 Sloth Digest

> **Private Overnight Gmail Executive Briefing & Reply-Debt Tracker**  
> *Built for Hacktoberfest 2026 Week 3: "Slow and Steady"*  
> **Lead Category:** Best Use of Gemma ($200) • **Secondary:** Best Use of Temporal, Best Use of Mastra

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Gemma](https://img.shields.io/badge/Gemma-4B_Instruct-blueviolet)](https://ai.google.dev/gemma)
[![llama.cpp](https://img.shields.io/badge/Runtime-llama.cpp_GGUF-orange)](https://github.com/ggerganov/llama.cpp)
[![Temporal](https://img.shields.io/badge/Orchestrator-Temporal_Workflows-black)](https://temporal.io)
[![Mastra](https://img.shields.io/badge/Agent-Mastra_TypeScript-indigo)](https://mastra.ai)

---

## 📖 What is Sloth Digest?

In honor of **International Sloth Day** and the Hacktoberfest 2026 *"Slow and Steady"* theme, **Sloth Digest** channels your inner sloth by doing the dreaded morning email catch-up while you sleep.

Instead of waking up to 40 unread emails, scrolling through noise, and dreading forgotten replies:
1. **Sleep through the night:** At 3:00 AM, a durable **Temporal** workflow wakes up on your home server.
2. **Read-only triage:** It examines new emails in your Gmail inbox without modifying read flags or leaving your local network.
3. **Local AI synthesis:** An open-weight **Gemma 4B** model running on **llama.cpp** categorizes bulk mail, summarizes personal threads into **strictly two lines**, and extracts direct asks.
4. **Durable Reply Debt:** Unanswered questions are ledgered into your persistent SQLite database. When you reply during the day, inspecting your `Sent` folder auto-clears the debt.
5. **Wake-up delivery:** At 7:00 AM, a scheduled **ntfy** push notification arrives on your phone with your reading time saved and action items, ready for review on a local LAN dashboard.

**Zero messages ever leave your machine or local network.**

---

## 🦥 The Lazy Payoff

| Without Sloth Digest | With Sloth Digest |
| :--- | :--- |
| 45 minutes spent sifting through newsletters, alerts, and multi-reply threads | **2-minute** executive briefing at breakfast |
| Anxiously searching "Did I reply to Sarah?" | Auto-tracked **Reply Debt** with days pending |
| Private emails sent to proprietary cloud AI APIs | **100% local inference** with Gemma 4B on CPU |
| Email clients marking things read prematurely | **Read-only IMAP (EXAMINE)** with UID cursors |

**Calculated Metric:** Based on the standard human reading rate of 238 words/minute, Sloth Digest saves **30 to 60+ minutes** of cognitive fatigue every morning.

---

## 🏗️ Architecture

```
                       ┌───────────────────────────────┐
                       │     Gmail (IMAP EXAMINE)      │
                       └──────────────┬────────────────┘
                                      │ Read-only fetch (UID cursors)
                                      ▼
                       ┌───────────────────────────────┐
                       │   Temporal Workflow (03:00)   │
                       └──────────────┬────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │ Map Activity            │ Triage Activity         │ Map Activity
            ▼                         ▼                         ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│  Gemma 4B (llama.cpp) │ │  Gemma 4B (llama.cpp) │ │  Gemma 4B (llama.cpp) │
│   Thread Summarizer   │ │   Bulk/Personal Class │ │   Reply Extractor     │
└───────────┬───────────┘ └───────────┬───────────┘ └───────────┬───────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      ▼
                       ┌───────────────────────────────┐
                       │  Reduce Activity & Payoff     │
                       │   - 2-Line Overview           │
                       │   - Sent Reply Reconciliation │
                       │   - SQLite State Store        │
                       └──────────────┬────────────────┘
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
       ┌─────────────────────────────┐ ┌─────────────────────────────┐
       │   LAN Web Dashboard (:3000) │ │   ntfy Push Delivery (07:00)│
       │    Interactive Dismiss      │ │   Mobile & Desktop Alerts   │
       └─────────────────────────────┘ └─────────────────────────────┘
```

### Why These Open Technologies?

- **Google Gemma 4B on llama.cpp**: Exceptional instruction following and reasoning in a compact footprint. Quantized to Q4_K_M GGUF, it runs efficiently even on CPU-only home servers. We enforce strict JSON output via GBNF grammar constraints.
- **Mastra**: Provides structured agent prompts, typed Zod validation, and schema isolation for triage and summarization tasks.
- **Temporal**: Gives genuine durability. If the home server reboots, the network blips, or the local model is busy, Temporal's activity retries, exponential backoff, and heartbeats ensure the digest finishes reliably before you wake up.

---

## 🚀 Quickstart

### 1. Prerequisites
- **Node.js 22+**
- **npm**
- (Optional for full containerized stack) **Docker & Docker Compose**

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/pbkhang404/dev-week3.git
cd dev-week3

# Install dependencies
npm install

# Copy configuration
cp .env.example .env
```

### 3. Quick Local Verification (Zero Setup Needed!)
You can test the entire pipeline immediately without configuring Gmail or external servers using our synthetic seed test:

```bash
# Run automated pipeline test suite
npm run test-pipeline

# Seed realistic synthetic demonstration emails into local SQLite
npm run seed -- --local

# Run the local standalone digest pipeline
npm run sloth -- run-local

# View active reply debt
npm run sloth -- debt

# Launch the LAN dashboard
npm run sloth -- serve
```
Open **`http://localhost:3000`** in your browser to inspect the interactive executive briefing!

---

## ⚙️ Configuration (`.env`)

```env
# Gmail IMAP Credentials (uses Gmail App Password with 2FA)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password

# llama.cpp Server (OpenAI-compatible /v1 endpoint running Gemma 4B)
LLAMA_SERVER_URL=http://localhost:8080
LLAMA_MODEL_NAME=gemma-2-4b-it

# Temporal Orchestration
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=sloth-digest

# ntfy Push Notifications (self-hosted LAN instance)
NTFY_URL=http://localhost:8088/sloth-digest
NTFY_SCHEDULE_TIME=07:00

# Local Storage
SQLITE_DB_PATH=./data/sloth.db
DIGEST_OUTPUT_DIR=./data/digests
WEB_PORT=3000
```

---

## 🐳 Full Homelab Deployment (Docker Compose)

Deploy the entire self-contained stack (llama-server, Temporal dev server, Temporal Web UI, ntfy gateway, and Sloth Digest) with one command:

```bash
# Place your Gemma GGUF model in ./models/gemma-2-4b-it.Q4_K_M.gguf
mkdir -p models

# Start the stack
docker compose up -d
```

Services exposed:
- **Sloth Digest Dashboard:** `http://localhost:3000`
- **Temporal Web UI:** `http://localhost:8233`
- **ntfy Push Gateway:** `http://localhost:8088`
- **llama.cpp Server:** `http://localhost:8080`

---

## 💻 CLI Commands

```bash
# Run one-off digest workflow immediately
npm run sloth -- run-now

# Run offline standalone pipeline without external Temporal
npm run sloth -- run-local

# Register the 03:00 AM nightly Temporal schedule
npm run sloth -- schedule

# Inspect pending reply debt items
npm run sloth -- debt

# Dismiss an action item manually
npm run sloth -- dismiss <DEBT_UUID>

# Start the LAN web viewer
npm run sloth -- serve

# Seed synthetic demonstration data
npm run seed
```

---

## 🔒 Privacy & Security

1. **Read-Only IMAP Mode:** Ingest opens mailboxes using IMAP `EXAMINE` (RFC 3501 §6.3.2). It never marks emails as `\Seen`, moves messages, or deletes anything.
2. **No Cloud LLM Calls:** All inference runs on your own hardware via llama.cpp.
3. **Local Persistence:** Data is stored strictly in a local SQLite database (`data/sloth.db`) with WAL mode enabled.
4. **Secret Isolation:** Passwords can be passed via Docker Secrets or environment variables; no credentials are ever written to git.

---

## 🏆 Hacktoberfest 2026 Submission Details

- **Challenge:** Hacktoberfest Open-Source AI Challenge: Week 3 ("Slow and Steady")
- **Tag:** `#hf26challenge`
- **Primary Category:** Best Use of Gemma ($200)
- **Secondary Categories:** Best Use of Temporal ($100), Best Use of Mastra ($100)
- **Author:** pbkhang404
- **License:** MIT
