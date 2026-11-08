// A dependency-free stand-in for DeepSeek's OpenAI-compatible chat completions API, for the end-to-end suite.
//
//   node e2e/mock-llm.mjs                 # listens on 127.0.0.1:3199 (E2E_LLM_PORT, E2E_LLM_HOST)
//
// The app reaches it through DEEPSEEK_BASE_URL=http://127.0.0.1:3199 (the openai SDK then posts to
// /chat/completions; /v1/chat/completions works too). It answers streaming (SSE) and non-streaming requests the way
// the SDK expects, with finish_reason and a final usage chunk. Scenarios are chosen per request, so parallel tests
// never interfere:
//
//   bearer key "rejected"        -> HTTP 401, as DeepSeek answers an invalid key
//   E2EKEY                       -> HTTP 401 as well (for a server started with a normal key)
//   E2ELEN                       -> an answer cut off with finish_reason "length" (the app's truncation notice)
//   E2EERR                       -> a few chunks, then an error event mid-stream
//   E2ESLOW                      -> about 300 ms per chunk, long enough to press Stop
//   anything else                -> a short Markdown note or chat answer that names the symbol in the prompt
//
// A marker counts in the latest user message (text a test types into the chat) or in the system messages (the
// context of a note or chat on the reserved symbol E2ELEN, E2EERR, E2ESLOW or E2EKEY, which the fixture data knows);
// earlier chat turns do not count. A client that disconnects ends its stream, as with DeepSeek. GET /health answers
// 200 for readiness checks; GET /stats counts the streams started, completed and cancelled per scenario. Nothing
// secret is logged: no keys, no prompts.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 1024 * 1024;
const MARKERS = { E2ELEN: "length", E2EERR: "error", E2ESLOW: "slow", E2EKEY: "rejected" };
const MARKER_PATTERN = /(?<![A-Z0-9])(E2ELEN|E2EERR|E2ESLOW|E2EKEY)(?![A-Z0-9])/;
const FAST_DELAY_MS = 12;
const SLOW_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ");
  return "";
}

/**
 * The scenario of a request: the latest user message decides first, then the system messages (the page's context,
 * where a note or chat on a reserved symbol names it). Earlier turns of a chat do not count, so a follow-up question
 * after a failed answer gets a normal answer.
 */
export function scenarioOf(messages, apiKey) {
  if (apiKey === "rejected") return "rejected";
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = [...list].reverse().find((message) => message?.role === "user");
  const inUser = MARKER_PATTERN.exec(textOf(lastUser?.content));
  if (inUser) return MARKERS[inUser[1]];
  const context = list.filter((message) => message?.role === "system").map((message) => textOf(message?.content));
  const inContext = MARKER_PATTERN.exec(context.join("\n"));
  return inContext ? MARKERS[inContext[1]] : "default";
}

/** Streams per scenario since the mock started: started, completed, and cancelled by the client (GET /stats). */
const stats = { started: {}, completed: {}, cancelled: {} };

function count(kind, scenario) {
  stats[kind][scenario] = (stats[kind][scenario] ?? 0) + 1;
}

/** What the answer is about: the note's subject, or the stock in the chat context. */
export function subjectOf(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = textOf([...list].reverse().find((message) => message?.role === "user")?.content);
  const note = /Write the note on (.+?) now/.exec(lastUser) ?? /撰写关于(.+?)的研究笔记/.exec(lastUser);
  if (note) return { subject: note[1], symbol: /^([A-Z0-9^][A-Z0-9.^=-]{0,14})\b/.exec(note[1])?.[1] ?? null, kind: "note" };
  const context = list.map((message) => textOf(message?.content)).join("\n");
  const stock = /Stock: ([A-Z0-9^][A-Z0-9.^=-]{0,14}) \(([^)]{1,80})\)/.exec(context);
  if (stock) return { subject: `${stock[1]} (${stock[2]})`, symbol: stock[1], kind: "chat" };
  const typed = /\b([A-Z]{2,5})\b/.exec(lastUser);
  return { subject: typed ? typed[1] : "the market", symbol: typed?.[1] ?? null, kind: "chat" };
}

function isChinese(messages) {
  const lastUser = textOf([...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message?.role === "user")?.content);
  return /[㐀-鿿]/.test(lastUser);
}

/** The answer text of a scenario. */
export function answerFor(messages, scenario) {
  const { subject, symbol, kind } = subjectOf(messages);
  const name = symbol ?? subject;
  if (isChinese(messages)) {
    if (scenario === "length") return `## 摘要\n\n${subject}的数据显示，最近一个交易日的走势与板块大致一致。由于长度限制，这份测试笔记在这里被截断，最后一句话没有写`;
    return [
      "## 摘要",
      "",
      `${subject}：这是端到端测试使用的模拟回答，不来自 DeepSeek。`,
      "",
      "## 数据要点",
      "",
      `- ${name} 的价格和成交量来自演示数据。`,
      "- 估值、动量和风险读数仅用于测试界面。",
      "",
      "## 后续关注",
      "",
      "- 下一次财报日期和指引。",
      "",
      "_测试用模拟回答。_",
    ].join("\n");
  }
  if (scenario === "length") {
    return `## Summary\n\n${subject} traded in line with its sector in the latest session, and the data shows a steady trend. This mock note runs into the length limit right here, so the last sentence stops before it`;
  }
  if (kind === "chat") {
    return [
      `**${name}**: this is a mock answer from the end-to-end test model, not from DeepSeek.`,
      "",
      `- The figures for ${name} on screen come from the fixture data.`,
      "- Ask a follow-up question to see the conversation continue.",
    ].join("\n");
  }
  return [
    "## Summary",
    "",
    `${subject} closed the latest session in line with the data shown on the page. This note comes from the end-to-end test model, not from DeepSeek.`,
    "",
    "## What the data shows",
    "",
    `- **Trend:** ${name} is trading near its 50-day average, with volume close to normal.`,
    "- **Valuation:** the multiples in the data sit inside their usual range for the sector.",
    "- **Risk:** the next earnings report is the main scheduled event.",
    "",
    "## What to watch",
    "",
    "- Guidance at the next report and any change in analyst estimates.",
    "- How the stock moves relative to its sector and the index.",
    "",
    "_Mock answer for automated tests._",
  ].join("\n");
}

/** Splits text into small pieces (a few words each), as a model streams it. */
export function chunksOf(text, size = 3) {
  const words = text.split(/(\s+)/);
  const chunks = [];
  for (let i = 0; i < words.length; i += size * 2) chunks.push(words.slice(i, i + size * 2).join(""));
  return chunks.filter((chunk) => chunk.length > 0);
}

function usageFor(messages, text) {
  const promptChars = (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + textOf(message?.content).length, 0);
  const prompt = Math.max(1, Math.round(promptChars / 4));
  const completion = Math.max(1, Math.round(text.length / 4));
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: prompt };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

let counter = 0;

async function streamAnswer(res, { model, messages, scenario, includeUsage }) {
  const id = `chatcmpl-mock-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: "chat.completion.chunk", created, model, system_fingerprint: "fp_mock" };
  // The response's "close" says when the client went away (the request's own "close" already fired once its body was
  // read). Before each pause and write the stream checks it, so a stopped answer ends here too, as DeepSeek's would.
  let closed = false;
  res.on("close", () => {
    if (res.writableEnded) return;
    closed = true;
    count("cancelled", scenario);
  });
  count("started", scenario);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (payload) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const text = answerFor(messages, scenario);
  const chunks = chunksOf(text, scenario === "slow" ? 1 : 3);
  const delay = scenario === "slow" ? SLOW_DELAY_MS : FAST_DELAY_MS;

  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }] });
  for (const [i, chunk] of chunks.entries()) {
    if (closed) return;
    if (scenario === "error" && i === 4) {
      send({ error: { message: "The mock model failed in the middle of the answer.", type: "server_error", param: null, code: "mock_stream_error" } });
      res.end();
      return;
    }
    await sleep(delay);
    if (closed) return;
    send({ ...base, choices: [{ index: 0, delta: { content: chunk }, logprobs: null, finish_reason: null }] });
  }
  send({ ...base, choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: scenario === "length" ? "length" : "stop" }] });
  if (includeUsage) send({ ...base, choices: [], usage: usageFor(messages, text) });
  if (closed) return;
  res.write("data: [DONE]\n\n");
  res.end();
  count("completed", scenario);
}

async function handleCompletion(req, res) {
  const authorization = req.headers.authorization ?? "";
  const apiKey = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? "";
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error", param: null, code: "invalid_json" } });
    return;
  }
  if (!apiKey) {
    sendJson(res, 401, { error: { message: "Missing API key", type: "authentication_error", param: null, code: "invalid_request_error" } });
    return;
  }
  const messages = body?.messages;
  const model = typeof body?.model === "string" ? body.model : "deepseek-chat";
  const scenario = scenarioOf(messages, apiKey);
  const stream = body?.stream === true;
  console.log(`[mock-llm] ${req.method} ${req.url} scenario=${scenario} stream=${stream}`);

  if (scenario === "rejected") {
    sendJson(res, 401, { error: { message: "Authentication Fails, Your api key is invalid", type: "authentication_error", param: null, code: "invalid_request_error" } });
    return;
  }
  if (stream) {
    await streamAnswer(res, { model, messages, scenario, includeUsage: body?.stream_options?.include_usage === true });
    return;
  }
  if (scenario === "error") {
    sendJson(res, 500, { error: { message: "The mock model failed.", type: "server_error", param: null, code: "mock_error" } });
    return;
  }
  if (scenario === "slow") await sleep(SLOW_DELAY_MS * 10);
  const text = answerFor(messages, scenario);
  sendJson(res, 200, {
    id: `chatcmpl-mock-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "fp_mock",
    choices: [{ index: 0, message: { role: "assistant", content: text }, logprobs: null, finish_reason: scenario === "length" ? "length" : "stop" }],
    usage: usageFor(messages, text),
  });
}

/** Starts the mock on host:port; resolves with the server once it listens. */
export function startMockLlm({ host = "127.0.0.1", port = 3199 } = {}) {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true, service: "mock-llm" });
      return;
    }
    if (req.method === "GET" && path === "/stats") {
      sendJson(res, 200, stats);
      return;
    }
    if (req.method === "POST" && (path === "/chat/completions" || path === "/v1/chat/completions")) {
      handleCompletion(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: { message: "Mock server error", type: "server_error", param: null, code: null } });
        else res.end();
      });
      return;
    }
    sendJson(res, 404, { error: { message: `No route for ${req.method} ${path}`, type: "invalid_request_error", param: null, code: "not_found" } });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.E2E_LLM_HOST || "127.0.0.1";
  const port = Number(process.env.E2E_LLM_PORT || 3199);
  startMockLlm({ host, port }).then(
    (server) => {
      console.log(`[mock-llm] listening on http://${host}:${port}`);
      const stop = () => server.close(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
    (error) => {
      console.error(`[mock-llm] could not listen on ${host}:${port}: ${error.message}`);
      process.exit(1);
    },
  );
}
