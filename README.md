# DeepSeek Web API (`deepseek-web-api`)

<p align="center">
  <img src="https://raw.githubusercontent.com/ZamilBinOfficial/deepseek-web-api/main/docs/assets/banner.png" alt="DeepSeek Web API Banner" width="100%" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <a href="https://github.com/ZamilBinOfficial/deepseek-web-api/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ZamilBinOfficial/deepseek-web-api/ci.yml?branch=main&style=flat-square&logo=github&label=CI" alt="CI Status"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://platform.openai.com/docs/api-reference"><img src="https://img.shields.io/badge/OpenAI-Compatible-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI Compatible"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-black?style=flat-square" alt="License: MIT"></a>
</p>

---

## ⚡ Overview

**DeepSeek Web API** is a high-performance local reverse-proxy bridge that converts authenticated [chat.deepseek.com](https://chat.deepseek.com) web sessions into a fully **OpenAI-compatible HTTP API** (`/v1/chat/completions`, `/v1/responses`, `/v1/models`).

It allows you to use your DeepSeek web account as a free, high-throughput drop-in replacement backend inside **Cursor**, **Continue**, **LibreChat**, **Open WebUI**, **Antigravity**, or any tool that expects an OpenAI-compatible endpoint — complete with **streamed reasoning**, **automatic PoW challenge solving**, and **DSML tool calling parsing**.

> [!NOTE]
> Designed for local workstation use. By default, the server binds strictly to `127.0.0.1` and is protected by local bearer API token authentication.

---

## 🚀 Key Features

* **Universal OpenAI Compatibility**:
  Full drop-in standard for `POST /v1/chat/completions`, `POST /v1/responses`, `GET /v1/models`, and `GET /health`. Compatible with all standard OpenAI SDKs (Python, Node.js, Go, Rust).
* **🧠 Real-Time Thinking & Reasoning Extraction**:
  Extracts DeepSeek's `<think>...</think>` tokens into OpenAI `reasoning_content` chunks during streaming. Keeps the final assistant `content` crystal clean without polluting downstream agent context.
* **🛠️ Native DSML Tool Calling Engine**:
  Parses DeepSeek's internal DSML formatting (`<｜tool calls begin｜>...<｜tool sep｜>...`) on-the-fly, transforming model outputs into standard OpenAI `tool_calls` JSON payloads.
* **⚡ Automated PoW Challenge Solver**:
  Built-in Chrome/CDP worker solves DeepSeek Web Proof-of-Work (PoW) mathematical challenges seamlessly in the background without user interruption.
* **🔒 Zero Token Costs / No API Billing**:
  Powered directly by your web session (`userToken` & secure cookies) — no paid API subscription or credit card needed.
* **💾 Multi-Turn Session Persistence**:
  Maintains clean `parent_message_id` lineage across conversational turns with automatic session renewal.
* **🪟 Windows 1-Click Launchers**:
  Includes standalone `.bat` and silent `.vbs` background launchers ready to place on your desktop or run as a startup service.

---

## 📋 Supported Models

| Model Identifier | Upstream Engine | Reasoning Support | Best For |
| :--- | :--- | :--- | :--- |
| `deepseek-v4` *(Default)* | DeepSeek-V4 Standard | ✅ Enabled (`reasoning_content`) | Everyday coding, chat, general intelligence |
| `deepseek-v4-pro` | DeepSeek-V4 Pro Mode | ✅ Deep Reasoning | Complex mathematics, architecture, large refactors |
| `deepseek-v4-flash` | DeepSeek-V4 Flash Mode | ⚡ Ultra-Fast Streaming | Rapid code completions, instant autocomplete |
| `deepseek-r1` | DeepSeek-R1 Full CoT | ✅ Chain-of-Thought | Exhaustive logic, proofs, self-correction |

---

## 🛠️ Quick Start

### 1. Prerequisites
* **Node.js**: `v20.0.0` or higher
* **Package Manager**: `pnpm` (recommended) or `npm`
* **Browser**: Google Chrome or Chromium installed

### 2. Installation & Build

```bash
# Clone the repository
git clone https://github.com/ZamilBinOfficial/deepseek-web-api.git
cd deepseek-web-api

# Install dependencies
pnpm install

# Compile TypeScript to dist/
pnpm build
```

### 3. Launch the Server

Run directly with default configuration (Port `8080` or `8787`):

```bash
pnpm start
```

Or on Windows, double-click **`START_DEEPSEEK_WEB_API.bat`**.

---

## 🔑 Authentication & Session Setup

1. **First-Time Login**:
   When launching for the first time, run:
   ```bash
   pnpm login
   ```
   A dedicated Chromium window will launch allowing you to sign into [chat.deepseek.com](https://chat.deepseek.com). Once logged in, your session token and cookies are encrypted and saved locally to `data/auth.json`.

2. **Local API Key**:
   All `/v1/*` endpoints are protected by an API key. You can specify your own key via the `DS_API_KEY` environment variable, or use the generated key in `data/.api-key`:
   ```bash
   # Default key if set in launcher:
   sk-deepseek
   ```

---

## 💡 Code Examples

### 1. Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="sk-deepseek"
)

# Streaming with live reasoning extraction
stream = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "system", "content": "You are a staff software engineer."},
        {"role": "user", "content": "Write a TypeScript function to parse DSML tool calls."}
    ],
    stream=True
)

for chunk in stream:
    # 1. Reasoning / Thinking stream
    if hasattr(chunk.choices[0].delta, "reasoning_content") and chunk.choices[0].delta.reasoning_content:
        print(chunk.choices[0].delta.reasoning_content, end="", flush=True)
    
    # 2. Main response stream
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### 2. Node.js / TypeScript (OpenAI SDK)

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:8080/v1",
  apiKey: "sk-deepseek",
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: "deepseek-v4",
    messages: [{ role: "user", content: "Explain how Proof of Work challenges work in Web Workers." }],
    stream: true,
  });

  for await (const chunk of completion) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
  }
}

main();
```

### 3. cURL (Terminal / Bash)

```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-deepseek" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello DeepSeek! Confirm system online."}
    ]
  }'
```

---

## 💻 Cursor & IDE Configuration

To use DeepSeek Web API as your main AI engine in **Cursor**, **Continue**, or **LibreChat**:

1. **Model Name**: `deepseek-v4` or `deepseek-v4-pro`
2. **OpenAI Base URL**: `http://127.0.0.1:8080/v1`
3. **API Key**: `sk-deepseek` (or value from `data/.api-key`)

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` (or `8787`) | Local HTTP port for the API server |
| `HOST` | `127.0.0.1` | Loopback bind host (do not expose to public web) |
| `DS_API_KEY` | *(Auto-generated)* | Custom Bearer token for client authentication |
| `DS_SHOW_BROWSER` | `0` | Set to `1` to show the Chromium window during PoW execution |
| `DS_CDP` | `http://127.0.0.1:9333` | Custom Chrome DevTools Protocol endpoint if using existing browser |

---

## 📁 Project Architecture

```
deepseek-web-api/
├── src/
│   ├── deepseek/              # Upstream Web API communication & DSML parsing
│   │   ├── client.ts          # Authenticated session HTTP fetcher
│   │   ├── completion.ts      # Streaming chunk processor & thinking extractor
│   │   ├── pow.ts             # Proof-of-Work solver integration
│   │   └── toolCalls.ts       # DSML & JSON schema tool call parser
│   ├── server/                # Express / Node HTTP API routes
│   │   ├── routes.ts          # /v1/chat/completions, /v1/models, /v1/responses
│   │   └── auth.ts            # Bearer token validation
│   └── index.ts               # CLI runner & bootstrap
├── tests/                     # Vitest unit & integration test suite
├── START_DEEPSEEK_WEB_API.bat # Windows 1-click launcher
└── package.json
```

---

## 🛡️ Security & Disclaimer

* **Unofficial Project**: This project is an independent open-source adapter and is not affiliated with, endorsed by, or sponsored by DeepSeek or OpenAI.
* **Local Loopback Only**: Never bind this server to `0.0.0.0` or expose it directly to the public Internet without reverse proxy protection (such as Cloudflare Access or Tailscale).
* **Credential Hygiene**: `data/auth.json`, `data/sessions.json`, and `data/.api-key` are automatically git-ignored. Never share or commit these files.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

Developed & maintained with ❤️ by [**Zamil Bin**](https://github.com/ZamilBinOfficial).
