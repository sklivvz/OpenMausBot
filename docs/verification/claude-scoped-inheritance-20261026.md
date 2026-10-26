# Claude tool selection with inherited MCP enabled

Liz's delegated research failed before launching Claude. The global
`features.claudeUserMcp` setting was enabled and her bot had an explicit MCP
deny list. The Claude driver rejected that combination even though the
installed CLI supported `--strict-mcp-config`.

An explicit bot tool scope now takes precedence over the global MCP inheritance
preference for that turn. The driver uses `--strict-mcp-config` and the existing
MCP gates. Unscoped bots retain their inheritance preference. Unknown CLI
versions, unsupported isolation and the environment-level user-configuration
escape hatch still fail closed. Models, bot restrictions and skills are unchanged.

Verification on 26 October 2026:

- The Claude driver suite passed: 226 tests, one skipped.
- The focused regression run passed five tests, including the isolated
  `launchVerificationServer` direct-chat and team-room workflow. The fixture
  enabled inherited MCP globally, dispatched scoped turns successfully, and
  inspected both the strict-isolation argument and the original gate scope.
- `pnpm build:server` passed.
- Oxlint passed for the three changed source/test files.

These checks establish startup and tool-boundary behavior, not completion of
Liz's business assignment. The deployment candidate contains only this change
over the installed image; activation requires restarting the application.
