# Shared Positron Tasks connection

Register one enabled HTTP MCP server named `positron-tasks`. Select that server for each bot that should use Positron Tasks. The runtime resolves its credential independently on each direct or room turn from `positron-tasks-credentials/<OMB bot id>.json` under the OpenMausBot data directory. Each file is private (mode 0600) and contains `botId`, `url`, and `authorization`. The bot ID must match the filename and the active bot, and the URL must exactly match the registered endpoint. Missing, malformed, shared, swapped, or differently scoped credentials leave that MCP unavailable for the turn. Other MCP servers remain available.

Keys are not stored in the shared registry entry. The server resolves the caller identity; it is never a tool argument. A changed key is picked up on a new turn. Do not remove earlier registrations until each affected bot has a verified private key file and selected the shared server; also check any independently configured consumers that still reference the old registrations.

Files are separate and are not sent to other bots' MCP sessions. File permissions alone do not isolate processes running as the same OS user with unrestricted filesystem access.
