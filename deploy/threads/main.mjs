#!/usr/bin/env node
import readline from "node:readline";
import { loadHostConfig } from "./config.mjs";
import { createThreads, toolDefinitions } from "./connector.mjs";
const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
let connector;
async function main() {
  for await (const line of lines) {
    let message;
    try {
      if (line.length > 32000) throw Error("size");
      message = JSON.parse(line);
      if (message.id === undefined) continue;
      let result;
      if (message.method === "initialize")
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "threads-connector", version: "1.0.0" },
        };
      else if (message.method === "tools/list")
        result = { tools: toolDefinitions };
      else if (message.method === "ping") result = {};
      else if (message.method === "tools/call") {
        let value;
        try {
          connector ??= createThreads(
            loadHostConfig(process.env.THREADS_CONFIG_FILE),
          );
          value = await connector.call(
            message.params?.name,
            message.params?.arguments,
          );
        } catch {
          value = {
            state: "blocked",
            reason: "host_configuration_unavailable",
            retryPublication: false,
          };
        }
        result = {
          content: [{ type: "text", text: JSON.stringify(value) }],
          isError: value.state === "blocked",
        };
      } else throw Error("method");
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
      );
    } catch {
      if (message?.id !== undefined)
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32600, message: "Invalid request" },
          }) + "\n",
        );
    }
  }
}
void main();
