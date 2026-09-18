# deepseek-web-api

A fast, lightweight local reverse proxy that turns your authenticated [chat.deepseek.com](https://chat.deepseek.com) session into a standard **OpenAI-compatible API** (`/v1/chat/completions`, `/v1/responses`, `/v1/models`).

Use DeepSeek-V4 and DeepSeek-R1 inside **Cursor**, **Continue**, **LibreChat**, or any OpenAI SDK with zero API token costs.

---

### ✨ Features

* **OpenAI Compatible**: Drop-in replacement for `/v1/chat/completions` and `/v1/models`.
* **Clean Reasoning**: Extracts `<think>...</think>` into `reasoning_content` so answers stay clean.
* **Tool Calling**: Native parser for DSML markup (`<｜tool calls begin｜>...`).
* **Zero Cost**: Runs directly via your authenticated web session with auto PoW solving.
* **1-Click Launch**: Double-click `START_DEEPSEEK_WEB_API.bat` to run on port `8080`.

---

### 🚀 Quickstart

```bash
# 1. Clone & install
git clone https://github.com/ZamilBinOfficial/deepseek-web-api.git
cd deepseek-web-api
pnpm install

# 2. Build & login (first time only)
pnpm build
pnpm login

# 3. Start server (default: http://127.0.0.1:8080)
pnpm start
```

---

### 💻 Usage

#### cURL
```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-deepseek" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Python (`openai`)
```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8080/v1", api_key="sk-deepseek")
response = client.chat.completions.create(
    model="deepseek-v4",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

### 📄 License

MIT © [Zamil Bin](https://github.com/ZamilBinOfficial)
