#!/usr/bin/env node

/**
 * MCP Explorer — универсальный интерактивный клиент
 *
 * Запуск:
 *   node client.mjs [-e KEY=VALUE ...] <команда запуска сервера...>
 *
 * Примеры:
 *   node client.mjs npx -y @modelcontextprotocol/server-filesystem /tmp
 *   node client.mjs node ./my-server.mjs
 *   node client.mjs uv run --directory ./plugins/cq/server cq-mcp-server
 *   node client.mjs -e CQ_TEAM_ADDR=http://localhost:8742 -e CQ_TEAM_API_KEY=secret \
 *     uv run --directory ./plugins/cq/server cq-mcp-server
 */

import { spawn } from "child_process";
import * as readline from "readline";

// ─── Парсим аргументы: сначала -e KEY=VALUE, потом команда ──────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error(`
Использование:
  node client.mjs [-e KEY=VALUE ...] <команда запуска mcp сервера...>

Примеры:
  node client.mjs npx -y @modelcontextprotocol/server-filesystem /tmp
  node client.mjs node ./my-server.mjs
  node client.mjs uv run --directory ./plugins/cq/server cq-mcp-server
  node client.mjs -e CQ_TEAM_ADDR=http://localhost:8742 -e CQ_TEAM_API_KEY=secret \\
    uv run --directory ./plugins/cq/server cq-mcp-server
`);
  process.exit(1);
}

// Вытаскиваем -e KEY=VALUE пары из начала аргументов
const extraEnv = {};
let i = 0;
while (i < rawArgs.length && rawArgs[i] === "-e") {
  const pair = rawArgs[i + 1];
  if (!pair || !pair.includes("=")) {
    console.error(`Неверный формат env переменной: -e ${pair ?? ""}\nОжидается: -e KEY=VALUE`);
    process.exit(1);
  }
  const eqIdx = pair.indexOf("=");
  const key = pair.slice(0, eqIdx);
  const val = pair.slice(eqIdx + 1);
  extraEnv[key] = val;
  i += 2;
}

const cmdArgs_all = rawArgs.slice(i);
if (cmdArgs_all.length === 0) {
  console.error("Укажи команду запуска MCP сервера после флагов -e");
  process.exit(1);
}

const [cmd, ...cmdArgs] = cmdArgs_all;

console.log(`\n🚀 Запускаем MCP сервер...`);
console.log(`   Команда: ${cmd} ${cmdArgs.join(" ")}`);
if (Object.keys(extraEnv).length > 0) {
  console.log(`   Env:     ${Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}
console.log();

// ─── Запускаем сервер как дочерний процесс ───────────────────────────────────

const server = spawn(cmd, cmdArgs, {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ...extraEnv }, // текущий env + переданные переменные
});

server.on("error", (err) => {
  console.error(`\n❌ Не удалось запустить процесс: ${err.message}`);
  console.error(`   Проверь что команда существует: ${cmd}`);
  process.exit(1);
});

server.stderr.on("data", (data) => {
  process.stdout.write(`\x1b[90m[server stderr] ${data}\x1b[0m`);
});

server.on("close", (code) => {
  console.log(`\n[сервер завершился с кодом ${code}]`);
  process.exit(0);
});

// ─── JSON-RPC ─────────────────────────────────────────────────────────────────

let requestId = 0;
let buffer = "";
const pending = new Map();

server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      console.error("Не смог распарсить ответ сервера:", line);
    }
  }
});

function handleMessage(msg) {
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(msg.error) : resolve(msg.result);
  } else if (msg.method) {
    console.log(`\x1b[90m[сервер уведомляет]: ${msg.method}\x1b[0m`);
  }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    pending.set(id, { resolve, reject });

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Timeout — сервер не ответил за 10 сек"));
      }
    }, 10000);
  });
}

// ─── Инициализация ────────────────────────────────────────────────────────────

async function initialize() {
  const result = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-explorer", version: "1.0.0" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return result;
}

// ─── Форматирование схемы аргументов ─────────────────────────────────────────

// Превращает inputSchema в читаемый пример JSON для вызова
function schemaToExample(schema) {
  if (!schema?.properties) return "{}";

  const required = schema.required || [];
  const obj = {};

  for (const [key, val] of Object.entries(schema.properties)) {
    const isRequired = required.includes(key);
    const type = val.type || "any";
    const placeholder =
      type === "string"  ? `"<${key}>"` :
      type === "number"  ? 0 :
      type === "boolean" ? false :
      type === "array"   ? "[]" :
      type === "object"  ? "{}" : `"<${key}>"`;

    obj[key] = `__${isRequired ? "REQ" : "OPT"}:${type}:${placeholder}__`;
  }

  // Сериализуем и делаем читаемым
  let example = JSON.stringify(obj, null, 2);

  // Заменяем плейсхолдеры на читаемые значения
  example = example.replace(/"__REQ:(\w+):(.+?)__"/g, (_, type, val) => val);
  example = example.replace(/"__OPT:(\w+):(.+?)__"/g, (_, type, val) => `${val} /*optional*/`);

  return example;
}

// ─── Команды ─────────────────────────────────────────────────────────────────

async function listTools(verbose = false) {
  const result = await send("tools/list");
  console.log("\n📦 Доступные инструменты:\n");
  for (const tool of result.tools) {
    console.log(`  \x1b[32m${tool.name}\x1b[0m`);
    const desc = tool.description?.split("\n")[0] || "";
    if (desc) console.log(`  \x1b[90m${desc}\x1b[0m`);

    if (verbose) {
      // Показываем полную схему
      console.log(`  Схема аргументов:`);
      console.log(JSON.stringify(tool.inputSchema, null, 2).split("\n").map(l => "    " + l).join("\n"));
    } else {
      // Показываем пример вызова
      const example = schemaToExample(tool.inputSchema);
      const oneLiner = example.replace(/\n\s*/g, " ");
      console.log(`  \x1b[33mcall ${tool.name}\x1b[0m \x1b[90m${oneLiner}\x1b[0m`);
    }
    console.log();
  }
  return result.tools;
}

async function callTool(toolName, toolArgs) {
  const result = await send("tools/call", { name: toolName, arguments: toolArgs });
  for (const block of result.content) {
    if (block.type === "text") {
      console.log("\n" + block.text + "\n");
    } else {
      console.log(`\n[block type: ${block.type}]\n`, JSON.stringify(block, null, 2), "\n");
    }
  }
}

function printHelp() {
  console.log(`
\x1b[33mКоманды:\x1b[0m

  tools                        — список инструментов с примерами вызова
  tools --schema               — то же, но с полной JSON Schema
  call <tool> [json-аргументы] — вызвать инструмент
  raw <method> [json-params]   — сырой JSON-RPC запрос
  resources                    — список ресурсов (если сервер поддерживает)
  prompts                      — список промптов (если сервер поддерживает)
  help                         — эта справка
  exit / quit                  — выход

\x1b[90mПодсказка: команда tools показывает готовые примеры вызовов — копируй и меняй значения\x1b[0m
`);
}

// ─── REPL ────────────────────────────────────────────────────────────────────

function startRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mmcp>\x1b[0m ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === "exit" || trimmed === "quit") {
      server.kill();
      process.exit(0);
    }

    const [cmd, ...rest] = trimmed.split(" ");

    try {
      switch (cmd) {
        case "tools":
          await listTools(rest[0] === "--schema");
          break;

        case "call": {
          const toolName = rest[0];
          if (!toolName) { console.log("Укажи имя инструмента: call <tool> [json]"); break; }
          const jsonStr = rest.slice(1).join(" ");
          const toolArgs = jsonStr ? JSON.parse(jsonStr) : {};
          await callTool(toolName, toolArgs);
          break;
        }

        case "raw": {
          const method = rest[0];
          if (!method) { console.log("Укажи метод: raw <method> [json-params]"); break; }
          const params = rest[1] ? JSON.parse(rest.slice(1).join(" ")) : {};
          const result = await send(method, params);
          console.log("\n" + JSON.stringify(result, null, 2) + "\n");
          break;
        }

        case "resources": {
          const result = await send("resources/list");
          console.log("\n" + JSON.stringify(result, null, 2) + "\n");
          break;
        }

        case "prompts": {
          const result = await send("prompts/list");
          console.log("\n" + JSON.stringify(result, null, 2) + "\n");
          break;
        }

        case "help":
          printHelp();
          break;

        default:
          console.log(`Неизвестная команда: ${cmd}. Напиши help.`);
      }
    } catch (err) {
      console.error("\x1b[31mОшибка:\x1b[0m", err.message || JSON.stringify(err));
    }

    rl.prompt();
  });

  rl.on("close", () => { server.kill(); process.exit(0); });
}

// ─── Старт ───────────────────────────────────────────────────────────────────

try {
  const info = await initialize();
  console.log(`✅ Соединение установлено!`);
  console.log(`   Сервер: ${info.serverInfo?.name} v${info.serverInfo?.version}`);
  console.log(`   Протокол: ${info.protocolVersion}`);

  const tools = await listTools();
  console.log(`   Всего инструментов: ${tools.length}`);
  console.log(`\nНапиши \x1b[33mhelp\x1b[0m для справки.\n`);

  startRepl();
} catch (err) {
  console.error("Не удалось подключиться к серверу:", err.message || err);
  process.exit(1);
}
