# MCP Explorer

Интерактивный клиент для ручного общения с MCP filesystem сервером.
Показывает что реально происходит между агентом и MCP сервером.

## Запуск

```bash
node client.mjs /tmp
```

Где `/tmp` — папка к которой сервер будет иметь доступ (можно любую).

## Что происходит под капотом

1. Скрипт делает `spawn("npx", [...])` — запускает MCP сервер как дочерний процесс
2. ОС создаёт анонимный pipe: наш stdin → его stdin, его stdout → наш stdout
3. Делается handshake: отправляем `initialize` → сервер отвечает своими capabilities
4. Дальше ты пишешь команды — они превращаются в JSON-RPC и пишутся в pipe

Реальный JSON который летит в сервер выглядит так:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_directory","arguments":{"path":"/tmp"}}}
```

## Команды

| Команда | Что делает |
|---------|-----------|
| `tools` | Список всех инструментов сервера |
| `ls [путь]` | Список файлов в папке |
| `tree [путь]` | Дерево папки |
| `cat <путь>` | Прочитать файл |
| `mkdir <путь>` | Создать папку |
| `write <путь> <текст>` | Записать файл |
| `allowed` | Показать разрешённые папки |
| `call <tool> <json>` | Вызвать инструмент напрямую |
| `raw <method> [json]` | Сырой JSON-RPC запрос |
| `help` | Справка |

## Примеры сессии

```
mcp> tools
📦 Доступные инструменты:
  read_text_file — Read complete contents of a file as text
  list_directory — List directory contents with [FILE] or [DIR] prefixes
  ...

mcp> ls /tmp
[FILE] hello.txt
[DIR]  my-folder

mcp> write /tmp/test.txt привет мир
mcp> cat /tmp/test.txt
привет мир

# Сырой JSON-RPC если хочется пощупать протокол руками:
mcp> raw tools/list
mcp> call get_file_info {"path":"/tmp"}
```
