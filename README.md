# MCP Explorer

Интерактивный клиент для ручного общения с любым MCP сервером через stdin/stdout.
Позволяет пощупать протокол руками — то же самое что делает AI агент, только ты сам.

## Запуск

```bash
node client.mjs [-e KEY=VALUE ...] <команда запуска mcp сервера...>
```

Флаги `-e` идут первыми, потом команда сервера.

### Примеры

```bash
# Node.js пакет
node client.mjs npx -y @modelcontextprotocol/server-filesystem /tmp

# локальный файл
node client.mjs node ./my-server.mjs

# Python
node client.mjs python my_server.py

# Python сервер через uv
node client.mjs uv run --directory ./path/to/server-folder mcp-server

# Python сервер с env переменными
node client.mjs -e CQ_TEAM_ADDR=http://localhost:8742 -e CQ_TEAM_API_KEY=secret \
  uv run --directory ./plugins/cq/server cq-mcp-server
```

## Передача env переменных

Некоторые MCP серверы требуют env переменные — API ключи, адреса и т.д.
Передаются флагом `-e KEY=VALUE`, можно несколько:

```bash
node client.mjs -e KEY1=value1 -e KEY2=value2 <команда сервера>
```

Переданные переменные добавляются поверх текущего окружения (`process.env`).
То есть всё что уже есть в твоём shell — тоже доступно серверу.

## Что происходит под капотом

```
client.mjs                        MCP сервер (дочерний процесс)
    │                                        │
    │── spawn(cmd, args, {env}) ──────────►  │  ОС создаёт анонимный pipe
    │                                        │
    │── stdin: {"method":"initialize"} ────► │
    │◄─ stdout: {"result":{...}}  ──────────  │
    │                                        │
    │── stdin: {"method":"tools/list"} ────► │
    │◄─ stdout: {"result":{"tools":[...]}} ─  │
    │                                        │
    │── stdin: {"method":"tools/call",...} ► │
    │◄─ stdout: {"result":{"content":[...]}}  │
```

Формат общения — JSON-RPC 2.0, каждое сообщение на отдельной строке.

Агент делает ровно то же самое — только вместо тебя решает модель.
Она получает список инструментов из `tools/list` вместе с JSON Schema каждого инструмента,
и по схеме сама собирает правильный JSON для вызова.

## Команды

| Команда | Что делает |
|---------|-----------|
| `tools` | Список инструментов с примерами вызова (из JSON Schema) |
| `tools --schema` | То же, но с полной сырой JSON Schema |
| `call <tool> <json>` | Вызвать инструмент |
| `raw <method> [json]` | Сырой JSON-RPC запрос |
| `resources` | Список ресурсов сервера (если поддерживает) |
| `prompts` | Список промптов сервера (если поддерживает) |
| `help` | Справка |
| `exit` / `quit` | Выход |

## Пример сессии

```
✅ Соединение установлено!
   Сервер: secure-filesystem-server v0.2.0
   Протокол: 2024-11-05

mcp> tools

📦 Доступные инструменты:

  write_file
  Create a new file or completely overwrite an existing file with new content.
  call write_file { "path": "<path>", "content": "<content>" }

  list_directory
  Get a detailed listing of all files and directories in a specified path.
  call list_directory { "path": "<path>" }

# Берём готовый пример из tools, подставляем значения:
mcp> call list_directory {"path":"/tmp"}

[DIR] my-folder
[FILE] hello.txt

# Полная схема как её видит модель:
mcp> tools --schema

# Сырой JSON-RPC:
mcp> raw tools/list
```

## Зависимости по типу сервера

Наш клиент универсальный — он просто запускает процесс и общается через pipe.
Но сам MCP сервер может быть написан на чём угодно, и нужный рантайм должен быть установлен.

| Сервер | Что нужно | Установка (macOS) |
|--------|-----------|-------------------|
| Node.js пакет | Node.js | `brew install node` |
| Python пакет | uv | `brew install uv` |
| Бинарник | ничего | — |

### uv — менеджер пакетов для Python

`uv` это аналог `npm` для Python. Одной командой заменяет `pip` + `virtualenv` + `pyenv`.

```bash
# установка
brew install uv

# запуск Python MCP сервера через uv (аналог npx для npm)
node client.mjs uv run --directory ./path/to/server server-entrypoint
```

При первом запуске uv сам создаст `.venv` в папке сервера и установит зависимости из `pyproject.toml`.
Повторные запуски — мгновенные, зависимости уже на месте.
