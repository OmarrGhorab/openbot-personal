### Added

- `bun run test:mcp-create` checks the whole "connect to a system with no MCP server" flow against a small sample HTTP API: the agent writes the server, starts it, registers it, tests it, calls one tool and updates it without a duplicate. It also checks that each change asks for approval with the new setting off and asks nothing with it on.
