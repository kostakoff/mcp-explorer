# MCP Explorer

Интерактивный клиент для ручного общения с любым MCP сервером через stdin/stdout.
Позволяет пощупать протокол руками — то же самое что делает AI агент, только ты сам.

## Запуск

```bash
node client.mjs <команда запуска mcp сервера...>
```

Всё что идёт после `client.mjs` — это команда которой запускается сервер.

### Примеры

```bash
# npm пакет
node client.mjs npx -y @modelcontextprotocol/server-filesystem /tmp

# локальный файл
node client.mjs node ./my-server.mjs

# python
node client.mjs python my_server.py

# uvx (uv)
node client.mjs uvx mcp-server-git --repository /tmp/repo

# вообще любой бинарник
node client.mjs ./my-mcp-server --some-flag
```

## Что происходит под капотом

```
client.mjs                        MCP сервер (дочерний процесс)
    │                                        │
    │── spawn() ──────────────────────────►  │  ОС создаёт анонимный pipe
    │                                        │
    │── stdin: {"method":"initialize"} ────► │
    │◄─ stdout: {"result":{...}}  ──────────  │
    │                                        │
    │── stdin: {"method":"tools/list"} ────► │
    │◄─ stdout: {"result":{"tools":[...]}} ─  │
    │                                        │
    │── stdin: {"method":"tools/call"} ────► │
    │◄─ stdout: {"result":{"content":[...]}}  │
```

Формат общения — JSON-RPC 2.0, каждое сообщение на отдельной строке.

Агент делает ровно то же самое — только вместо тебя решает модель:
читает список инструментов из `tools/list` и сама выбирает что и когда вызвать.

## Команды

| Команда | Что делает |
|---------|-----------|
| `tools` | Список всех инструментов сервера |
| `call <tool> [json]` | Вызвать инструмент с аргументами |
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

  read_text_file    — Read the complete contents of a file...
  write_file        — Create a new file or completely overwrite...
  list_directory    — Get a detailed listing of all files...
  ...

mcp> call list_directory {"path":"/tmp"}

[DIR] my-folder
[FILE] hello.txt

mcp> call write_file {"path":"/tmp/test.txt","content":"hello world"}

Successfully wrote to /tmp/test.txt

# Посмотреть сырой JSON-RPC — что реально летит по протоколу:
mcp> raw tools/list
mcp> raw resources/list
```
