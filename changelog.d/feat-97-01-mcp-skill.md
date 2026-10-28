### Added

- Agents can connect to a system that has no MCP server, such as a REST or GraphQL API, a database, a CLI or local code. A new built-in skill tells the agent to write a small MCP server in `~/OpenBot/mcp-servers/<name>/`, start it once, register it, test it and report its tools. Keys stay in environment variables that you enter in Server settings, MCP. To add a tool or fix an error, the agent changes the same server and does not add a second one.
