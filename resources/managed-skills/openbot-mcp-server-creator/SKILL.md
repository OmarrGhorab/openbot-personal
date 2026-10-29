---
name: openbot-mcp-server-creator
description: Write, register, test, and update an MCP server for a system that has none, such as a REST or GraphQL API, a database, a CLI, or local code. Use when the user asks you to connect to a system at a path or URL and no MCP server or Marketplace app exists for it.
---

# Create an MCP server for a system

The user asked you to connect to a system, and no MCP server exists for it. Read the system, write a small MCP server for it, register the server with the OpenBot MCP tools, test it, and report its tools. Every agent on this OpenBot server gets the tools of an enabled server, so say that in your answer.

Do not use this skill when an MCP server or a Marketplace app already covers the system. Call `openbot.suggest_marketplace_app` first for a known public service, and use an MCP address that the service publishes when the user gives one.

## 1. Check what exists

1. Call `openbot.list_mcp_servers`. A server with the same name, or with a command that points into `~/OpenBot/mcp-servers/<name>/`, already exists: go to [Update a server](#update-a-server). Never make a second server for the same system.
2. Look for `~/OpenBot/mcp-servers/<name>/openbot-mcp.json`. It records a server that an agent made before. Read it before you write code.

## 2. Read the system

Find the system type from what the user gives you:

| The user gives | System type | Read |
| --- | --- | --- |
| An `http` or `https` URL, an OpenAPI or GraphQL schema | REST or GraphQL API | The schema, the API documentation, or a sample response |
| A connection string, a database file, a schema dump | Database | The tables, the columns, and the keys. Read only. |
| A command name or a binary | CLI | `--help` and the manual of each subcommand |
| A folder of source code | Local code | The public functions, the entry points, and the README |

Read only. Do not change the system, its data, or its configuration while you read it. When you cannot find what the system does, ask the user one short question.

## 3. Choose the design

- **Transport.** Use `stdio` for a system on this computer (local code, a CLI, a local database, an API on `localhost`). The server is a local command that OpenBot starts. Use `http` only when the server itself must run on another computer; then the user starts it there and gives you its address.
- **Language and SDK.** Use TypeScript with `@modelcontextprotocol/sdk` by default. Use Python with the `mcp` package when the system is Python code or the user asks for Python.
- **Name.** Use a short lowercase name with `-` between words, such as `inventory-api`. It is the folder name and the server name.
- **Tools.** Map each operation that the user needs to one MCP tool. Give each tool a clear verb name (`list_orders`, `get_order`, `create_order`), a description that says what it does and what it returns, and an input schema with a type and a description for each field. Start with the read operations. Add a tool that changes data only when the user asks for it, and say in its description that it changes data. Keep each result short: return the fields that the user needs, and limit long lists.

## 4. Write the server

1. Put the server in `~/OpenBot/mcp-servers/<name>/`. Make the folder when it does not exist. Never put the server in the user's project or in your workspace, unless the user asks for that place.
2. Write the code, a `package.json` (or `pyproject.toml`), and a short `README.md` that names the tools and the environment variables.
3. Read each secret (an API key, a token, a password, a connection string with a password) from an environment variable only, such as `process.env.INVENTORY_API_KEY`. Never write a secret into the code, a file in the folder, an argument, or a URL. Never print a secret to the log.
4. The server must start and list its tools when a secret is missing. A tool that needs the missing secret returns an error that names the environment variable and says: "Enter it in Server settings, MCP."
5. Write `openbot-mcp.json` beside the code:

   ```json
   {
     "name": "inventory-api",
     "system": "http://localhost:4000",
     "systemType": "rest",
     "transport": "stdio",
     "command": "node",
     "args": ["/home/me/OpenBot/mcp-servers/inventory-api/dist/index.js"],
     "environment": ["INVENTORY_API_KEY"],
     "tools": ["list_orders", "get_order"]
   }
   ```

   It holds names only, never a value.

## 5. Install and start it once

1. Install the dependencies in the server folder (`npm install`, or `pip install` in a virtual environment in the folder). Build the code when it needs a build.
2. Start the server once with the command that OpenBot will use, and send it an MCP `initialize` and a `tools/list` request, or use `npx @modelcontextprotocol/inspector --cli <command> --method tools/list`. Confirm that it starts and lists the tools. Fix each error and start it again.
3. Use an absolute path to the entry file in the command arguments. Use a command that does not change when you change the code, such as `node <folder>/dist/index.js` or `<folder>/.venv/bin/python <folder>/server.py`.

Do not report success before the server starts and lists its tools.

## 6. Register and test it

1. Call `openbot.save_mcp_server` with the name, `transport: "stdio"`, the command, the arguments, and `workingDirectory` set to the server folder. For an `http` server, give the `url`.
2. `save_mcp_server` connects to the server before it saves it. Read the status:
   - `ready`: the server is saved. Go to step 3.
   - `needs_key`: the server is saved and needs a key. Tell the user to enter the key in Server settings, MCP, then call `openbot.test_mcp_server` when the user says it is done.
   - `needs_sign_in`: tell the user to press Sign in on the card in this conversation, and end your turn. Test again when the user says it is done.
   - `error`: the server is not saved. Fix the cause, start the server once again (step 5), and save again with the same name.
3. When the server needs an environment variable, tell the user its name and say: "Enter it in Server settings, MCP, on the `<name>` server." Never ask the user to paste a key, a token, or a password into the chat.
4. The new tools reach you and the other agents from the next turn. When the user asked for a result, tell the user that you can use the tools from the next message.

## 7. Report

Tell the user, in plain words:

- The server name and the folder.
- The tools that the server gives, one line each.
- The environment variables that the user must enter, by name, when there are any.
- That every agent on this OpenBot server can use the tools.

## Update a server

To add a tool or to fix an error in a server that exists:

1. Read `openbot-mcp.json` and the code in `~/OpenBot/mcp-servers/<name>/`. Change the code in that folder. Do not make a new folder or a new server.
2. Install, build, and start it once again (step 5).
3. Keep the same name, command, arguments, and folder. Then call `openbot.test_mcp_server` with the name. A server that holds keys keeps its command, arguments, and folder: a change to them is refused, and only the user can make it in Server settings, MCP.
4. When the command or the arguments must change and the server holds no keys, call `openbot.save_mcp_server` with the same name. The same name changes the server; it does not add one.
5. Update the `tools` list in `openbot-mcp.json`, and report the tools that changed.

## Rules

- Secrets never reach the chat, the code, the log, a URL, or an argument.
- Never make a duplicate: one system, one folder, one server name.
- Test before you report success. A server that does not start is not done.
- A generated server sends data only to the system that the user named. Do not add calls to other services.
