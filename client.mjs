#!/usr/bin/env node

/**
 * MCP Explorer — интерактивный клиент для filesystem MCP сервера
 * Запуск: node client.mjs /путь/к/папке
 */

import { spawn } from "child_process";
import * as readline from "readline";

// ─── Запускаем MCP сервер как дочерний процесс ───────────────────────────────

const allowedDir = process.argv[2] || "/tmp";

console.log(`\n🚀 Запускаем MCP filesystem сервер...`);
console.log(`   Разрешённая папка: ${allowedDir}\n`);

const server = spawn("npx", ["-y", "@modelcontextprotocol/server-filesystem", allowedDir], {
  stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr — всё через pipe
});

// Ошибки сервера пишем в консоль серым цветом
server.stderr.on("data", (data) => {
  process.stdout.write(`\x1b[90m[server stderr] ${data}\x1b[0m`);
});

server.on("close", (code) => {
  console.log(`\n[сервер завершился с кодом ${code}]`);
  process.exit(0);
});

// ─── JSON-RPC общение ────────────────────────────────────────────────────────

let requestId = 0;
let buffer = "";
const pending = new Map(); // id → { resolve, reject }

// Читаем stdout сервера — там приходят JSON-RPC ответы
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();

  // Сервер шлёт каждый JSON на отдельной строке
  const lines = buffer.split("\n");
  buffer = lines.pop(); // последняя строка может быть неполной

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch (e) {
      console.error("Не смог распарсить ответ сервера:", line);
    }
  }
});

function handleMessage(msg) {
  if (msg.id !== undefined && pending.has(msg.id)) {
    // Это ответ на наш запрос
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(msg.error);
    } else {
      resolve(msg.result);
    }
  } else if (msg.method) {
    // Это уведомление от сервера (нам пока не нужно)
    console.log(`\x1b[90m[сервер уведомляет]: ${msg.method}\x1b[0m`);
  }
}

// Отправить JSON-RPC запрос → вернёт Promise с результатом
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = { jsonrpc: "2.0", id, method, params };
    pending.set(id, { resolve, reject });

    const line = JSON.stringify(msg) + "\n";
    server.stdin.write(line);

    // Таймаут 10 секунд
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Timeout — сервер не ответил за 10 сек"));
      }
    }, 10000);
  });
}

// ─── Инициализация (обязательный handshake по протоколу MCP) ─────────────────

async function initialize() {
  const result = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-explorer", version: "1.0.0" },
  });
  // После initialize нужно отправить notification initialized
  const notif = { jsonrpc: "2.0", method: "notifications/initialized" };
  server.stdin.write(JSON.stringify(notif) + "\n");
  return result;
}

// ─── Готовые команды для удобства ────────────────────────────────────────────

const commands = {
  // Показать список всех инструментов сервера
  async tools() {
    const result = await send("tools/list");
    console.log("\n📦 Доступные инструменты:\n");
    for (const tool of result.tools) {
      console.log(`  \x1b[32m${tool.name}\x1b[0m — ${tool.description}`);
    }
    console.log();
  },

  // Вызвать любой инструмент
  async call(toolName, toolArgs) {
    const result = await send("tools/call", {
      name: toolName,
      arguments: toolArgs,
    });
    // Результат — массив content блоков
    for (const block of result.content) {
      if (block.type === "text") {
        console.log("\n" + block.text + "\n");
      } else {
        console.log("\n[block типа:", block.type, "]\n", block);
      }
    }
  },

  // Список файлов в папке
  async ls(path) {
    await commands.call("list_directory", { path: path || allowedDir });
  },

  // Прочитать файл
  async cat(path) {
    await commands.call("read_text_file", { path });
  },

  // Создать папку
  async mkdir(path) {
    await commands.call("create_directory", { path });
  },

  // Записать файл
  async write(path, content) {
    await commands.call("write_file", { path, content });
  },

  // Дерево папки
  async tree(path) {
    await commands.call("directory_tree", { path: path || allowedDir });
  },

  // Показать разрешённые папки
  async allowed() {
    await commands.call("list_allowed_directories", {});
  },

  // Отправить сырой JSON-RPC (для экспериментов)
  async raw(method, paramsJson) {
    const params = paramsJson ? JSON.parse(paramsJson) : {};
    const result = await send(method, params);
    console.log("\n" + JSON.stringify(result, null, 2) + "\n");
  },

  help() {
    console.log(`
\x1b[33mДоступные команды:\x1b[0m

  tools                          — список всех инструментов сервера
  ls [путь]                      — список файлов в папке
  tree [путь]                    — дерево папки
  cat <путь>                     — прочитать файл
  mkdir <путь>                   — создать папку
  write <путь> <содержимое>      — записать файл
  allowed                        — показать разрешённые папки
  call <tool> <json-аргументы>   — вызвать инструмент напрямую
  raw <method> [json-params]     — сырой JSON-RPC запрос

  exit / quit                    — выход

\x1b[90mПримеры:\x1b[0m
  ls
  ls /tmp
  cat /tmp/test.txt
  mkdir /tmp/new-folder
  write /tmp/hello.txt привет мир
  call get_file_info {"path":"/tmp"}
  raw tools/list
`);
  },
};

// ─── REPL — читаем команды от пользователя ───────────────────────────────────

async function startRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mmcp>\x1b[0m ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === "exit" || trimmed === "quit") {
      server.kill();
      process.exit(0);
    }

    // Разбираем строку: первое слово — команда, остальное — аргументы
    const [cmd, ...rest] = trimmed.split(" ");

    try {
      if (cmd === "tools") {
        await commands.tools();
      } else if (cmd === "ls") {
        await commands.ls(rest[0]);
      } else if (cmd === "cat") {
        await commands.cat(rest.join(" "));
      } else if (cmd === "mkdir") {
        await commands.mkdir(rest.join(" "));
      } else if (cmd === "write") {
        await commands.write(rest[0], rest.slice(1).join(" "));
      } else if (cmd === "tree") {
        await commands.tree(rest[0]);
      } else if (cmd === "allowed") {
        await commands.allowed();
      } else if (cmd === "call") {
        const toolName = rest[0];
        const toolArgs = rest[1] ? JSON.parse(rest.slice(1).join(" ")) : {};
        await commands.call(toolName, toolArgs);
      } else if (cmd === "raw") {
        await commands.raw(rest[0], rest.slice(1).join(" "));
      } else if (cmd === "help") {
        commands.help();
      } else {
        console.log(`Неизвестная команда: ${cmd}. Напиши help для справки.`);
      }
    } catch (err) {
      console.error("\x1b[31mОшибка:\x1b[0m", err.message || err);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    server.kill();
    process.exit(0);
  });
}

// ─── Старт ───────────────────────────────────────────────────────────────────

try {
  const info = await initialize();
  console.log(`✅ Соединение установлено!`);
  console.log(`   Сервер: ${info.serverInfo?.name} v${info.serverInfo?.version}`);
  console.log(`   Протокол: ${info.protocolVersion}`);
  console.log(`\nНапиши \x1b[33mhelp\x1b[0m для списка команд, \x1b[33mtools\x1b[0m чтобы увидеть что умеет сервер.\n`);
  startRepl();
} catch (err) {
  console.error("Не удалось подключиться к серверу:", err);
  process.exit(1);
}
