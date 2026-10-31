# 🦥 Sloth Digest

> **Private Overnight Gmail Executive Briefing & Reply-Debt Tracker**  
> _Built for Hacktoberfest 2026 Week 3: "Slow and Steady"_  
> **Lead Category:** Best Use of Gemma ($200) • **Secondary:** Best Use of Temporal, Best Use of Mastra

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Gemma](https://img.shields.io/badge/Gemma-4B_Instruct-blueviolet)](https://ai.google.dev/gemma)
[![llama.cpp](https://img.shields.io/badge/Runtime-llama.cpp_GGUF-orange)](https://github.com/ggerganov/llama.cpp)
[![Temporal](https://img.shields.io/badge/Orchestrator-Temporal_Workflows-black)](https://temporal.io)
[![Mastra](https://img.shields.io/badge/Agent-Mastra_TypeScript-indigo)](https://mastra.ai)

---

## 📖 What is Sloth Digest?

In honor of **International Sloth Day** and the Hacktoberfest 2026 _"Slow and Steady"_ theme, **Sloth Digest** channels your inner sloth by doing the dreaded morning email catch-up while you sleep.

Instead of waking up to 40 unread emails, scrolling through noise, and dreading forgotten replies:

1. **Sleep through the night:** At 6:00 AM, a durable **Temporal** workflow wakes up on your home server.
2. **Read-only triage:** It examines new emails in your Gmail inbox without modifying read flags or leaving your local network.
3. **Local AI synthesis:** An open-weight **Gemma 4B** model running on **llama.cpp** categorizes bulk mail, summarizes personal threads into **strictly two lines**, and extracts direct asks.
4. **Durable Reply Debt:** Unanswered questions are ledgered into your persistent SQLite database. When you reply during the day, inspecting your `Sent` folder auto-clears the debt.
5. **Wake-up delivery:** At 7:00 AM, a scheduled **ntfy** push notification arrives on your phone with your reading time saved and action items, ready for review on a local LAN dashboard.

**Zero messages ever leave your machine or local network.**

---

## 🦥 The Lazy Payoff

| Without Sloth Digest                                                          | With Sloth Digest                             |
| :---------------------------------------------------------------------------- | :-------------------------------------------- |
| 45 minutes spent sifting through newsletters, alerts, and multi-reply threads | **2-minute** executive briefing at breakfast  |
| Anxiously searching "Did I reply to Sarah?"                                   | Auto-tracked **Reply Debt** with days pending |
| Private emails sent to proprietary cloud AI APIs                              | **100% local inference** with Gemma 4B on CPU |
| Email clients marking things read prematurely                                 | **Read-only IMAP (EXAMINE)** with UID cursors |

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
git clone https://github.com/AndyKhang404/sloth-digest.git
cd sloth-digest

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
# Optional: Path to file containing password (for Docker secrets)
# GMAIL_APP_PASSWORD_FILE=/run/secrets/gmail_password

# llama.cpp Server (OpenAI-compatible /v1 endpoint running Gemma)
LLAMA_SERVER_URL=http://localhost:8080
LLAMA_MODEL_NAME=gemma-2-2b-it
LLAMA_MODEL_FILE=gemma-2-2b-it-Q4_K_M.gguf

# Temporal Orchestration
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=sloth-digest
DIGEST_SCHEDULE_HOUR=6
DIGEST_SCHEDULE_MINUTE=0

# ntfy Push Notifications (self-hosted LAN instance)
NTFY_URL=http://localhost:8088/sloth-digest
NTFY_SCHEDULE_TIME=07:00

# Local Storage & Web Dashboard
SQLITE_DB_PATH=./data/sloth.db
DIGEST_OUTPUT_DIR=./data/digests
WEB_PORT=3000
# Optional: Require Bearer or HTTP Basic auth password on the web dashboard
# WEB_AUTH_TOKEN=your-secret-dashboard-token
```

---

## 🐳 Full Homelab Deployment (Docker Compose)

Deploy the entire self-contained stack (`llama-server`, `temporal` dev server + built-in Web UI, `ntfy` push gateway, and the unified `sloth-app` worker + dashboard) with one command:

```bash
# Place your quantized Gemma GGUF model in ./models/
mkdir -p models

# Build and start all containers in the background
docker compose up -d --build
```

### Services & Port Bindings

| Container | Service Role | Host Binding | Notes |
| :--- | :--- | :--- | :--- |
| `sloth-app` | Unified Temporal Worker + Web Dashboard | `0.0.0.0:3000` | Plain `http://` LAN/local dashboard (runs as non-root `node` user, `sloth_data` volume) |
| `sloth-temporal` | Temporal Server + Built-in Web UI | `127.0.0.1:7233`, `127.0.0.1:8233` | Loopback-only gRPC & Web UI (runs as non-root `temporal` user, `temporal_data` volume) |
| `sloth-ntfy` | Self-hosted Push Notification Server | `0.0.0.0:8088` | LAN HTTP gateway for mobile push (`ntfy_cache` volume) |
| `sloth-llama` | Local Gemma GGUF Inference (`llama.cpp`) | `127.0.0.1:8080` | Loopback-only OpenAI-compatible `/v1` server (`./models` mounted read-only) |

> **Note when connecting from another machine on your LAN:** Connect using plain HTTP (`http://<HOST_IP>:3000/`). If your browser has HTTPS-Only Mode enabled, disable it for `<HOST_IP>:3000` so the browser does not attempt a TLS handshake against the plain HTTP server.

### Running Commands Inside the Container

```bash
# Seed synthetic demo emails inside the container volume
docker exec -it sloth-app npx tsx scripts/seed-gmail.ts --local

# Trigger the Temporal workflow immediately inside the stack
docker exec -it sloth-app npx tsx src/cli.ts run-now

# Register the 06:00 AM daily schedule in Temporal
docker exec -it sloth-app npx tsx src/cli.ts schedule
```

---

## 💻 CLI Commands (Local Host)

```bash
# Run one-off digest workflow immediately (falls back to local execution if Temporal is offline)
npm run sloth -- run-now

# Run offline standalone pipeline without external Temporal
npm run sloth -- run-local

# Register the 06:00 AM morning Temporal schedule
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

## 🔒 Privacy & Security Architecture

1. **Read-Only IMAP Mode:** Ingestion opens `INBOX` and `Sent` mailboxes strictly using IMAP `EXAMINE` (RFC 3501 §6.3.2). It never marks emails as `\Seen`, modifies flags, or deletes messages.
2. **Zero Cloud Calls & Loopback Isolation:** All LLM inference runs locally on `llama.cpp`. Internal infrastructure ports (`llama-server`, `temporal`, `ntfy`) are bound strictly to `127.0.0.1` on the host.
3. **Optional Dashboard Authentication:** Setting `WEB_AUTH_TOKEN` (or `WEB_AUTH_TOKEN_FILE`) protects all dashboard and API routes with constant-time (`crypto.timingSafeEqual`) HTTP Basic and Bearer token verification.
4. **Indirect Prompt Injection Defenses:**
   - Email HTML is converted to plain text with `<script>`, `<style>`, `<img>`, and hrefs stripped, alongside removal of invisible zero-width and bidirectional override Unicode characters.
   - Untrusted email fields are isolated inside `<untrusted_email_data>` XML boundaries with anti-breakout tag neutralization.
   - LLM outputs are validated against strict `zod` schemas, and any Message-ID cited as needing a reply is cross-checked against an allowlist of actual Message-IDs in the thread.
5. **Web Dashboard XSS, CSRF, & DoS Hardening:**
   - All dynamic email metadata and LLM summaries are HTML- and attribute-escaped before rendering.
   - Inline event handlers are disabled via `Content-Security-Policy` (`script-src-attr 'none'; frame-ancestors 'none'`) alongside `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`.
   - `POST /api/dismiss` enforces same-origin verification, `Content-Type: application/json`, and a strict 4 KB request body cap.
6. **Non-Root Containers & Restrictive File Permissions:** Both `sloth-app` (`USER node`) and `sloth-temporal` (`USER temporal`) execute as non-root `UID 1000` users with `0600`/`0700` file and directory permissions on SQLite and digest artifacts.

---

## 🏆 Hacktoberfest 2026 Submission Details

- **Challenge:** Hacktoberfest Open-Source AI Challenge: Week 3 ("Slow and Steady")
- **Tag:** `#hf26challenge`
- **Primary Category:** Best Use of Gemma ($200)
- **Secondary Categories:** Best Use of Temporal ($100), Best Use of Mastra ($100)
- **Repository:** [https://github.com/AndyKhang404/sloth-digest](https://github.com/AndyKhang404/sloth-digest)
- **Author:** [AndyKhang404](https://github.com/AndyKhang404)
- **License:** MIT
