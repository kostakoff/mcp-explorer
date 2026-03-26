# MCP Explorer

An interactive client for manually communicating with any MCP server via stdin/stdout.
Lets you feel the protocol with your own hands — the same thing an AI agent does, except you're the one doing it.

## Running

```bash
node client.mjs [-e KEY=VALUE ...] <mcp server launch command...>
```

The `-e` flags come first, then the server command.

### Examples

```bash
# Node.js package
node client.mjs npx -y @modelcontextprotocol/server-filesystem /tmp

# local file
node client.mjs node ./my-server.mjs

# Python
node client.mjs python my_server.py

# Python server via uv
node client.mjs uv run --directory ./path/to/server-folder mcp-server

# Python server with env variables
node client.mjs -e CQ_TEAM_ADDR=http://localhost:8742 -e CQ_TEAM_API_KEY=secret \
  uv run --directory ./plugins/cq/server cq-mcp-server
```

## Passing env variables

Some MCP servers require env variables — API keys, addresses, etc.
Pass them with the `-e KEY=VALUE` flag, multiple are allowed:

```bash
node client.mjs -e KEY1=value1 -e KEY2=value2 <server command>
```

The provided variables are added on top of the current environment (`process.env`).
This means everything already in your shell is also available to the server.

## What's happening under the hood

```
client.mjs                        MCP server (child process)
    │                                        │
    │── spawn(cmd, args, {env}) ──────────►  │  OS creates an anonymous pipe
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

The communication format is JSON-RPC 2.0, one message per line.

An agent does exactly the same thing — except it's the model making the decisions instead of you.
It receives the list of tools from `tools/list` along with the JSON Schema for each tool,
and uses the schema to construct the correct JSON for each call on its own.

## Commands

| Command | What it does |
|---------|-------------|
| `tools` | List of tools with call examples (from JSON Schema) |
| `tools --schema` | Same, but with the full raw JSON Schema |
| `call <tool> <json>` | Call a tool |
| `raw <method> [json]` | Raw JSON-RPC request |
| `resources` | List of server resources (if supported) |
| `prompts` | List of server prompts (if supported) |
| `help` | Help |
| `exit` / `quit` | Quit |

## Example session

```
✅ Connection established!
   Server: secure-filesystem-server v0.2.0
   Protocol: 2024-11-05

mcp> tools

📦 Available tools:

  write_file
  Create a new file or completely overwrite an existing file with new content.
  call write_file { "path": "<path>", "content": "<content>" }

  list_directory
  Get a detailed listing of all files and directories in a specified path.
  call list_directory { "path": "<path>" }

# Take the ready-made example from tools, fill in the values:
mcp> call list_directory {"path":"/tmp"}

[DIR] my-folder
[FILE] hello.txt

# Full schema as seen by the model:
mcp> tools --schema

# Raw JSON-RPC:
mcp> raw tools/list
```

## Dependencies by server type

Our client is universal — it simply launches a process and communicates via pipe.
But the MCP server itself can be written in anything, and the required runtime must be installed.

| Server | What's needed | Install (macOS) |
|--------|--------------|-----------------|
| Node.js package | Node.js | `brew install node` |
| Python package | uv | `brew install uv` |
| Binary | nothing | — |

### uv — Python package manager

`uv` is the Python equivalent of `npm`. It replaces `pip` + `virtualenv` + `pyenv` in a single command.

```bash
# install
brew install uv

# run a Python MCP server via uv (like npx for npm)
node client.mjs uv run --directory ./path/to/server server-entrypoint
```

On the first run, uv will automatically create a `.venv` in the server folder and install dependencies from `pyproject.toml`.
Subsequent runs are instant — dependencies are already in place.
