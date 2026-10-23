import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createThreads, hash } from "./connector.mjs";

async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-threads-"));
  const artifacts = path.join(dir, "artifacts");
  fs.mkdirSync(artifacts);
  const grants = path.join(dir, "grants");
  fs.mkdirSync(grants, { mode: 0o700 });
  const now = () => new Date("2026-10-23T12:00:00Z");
  const config = {
    accountId: "123",
    credentialFile: path.join(dir, "credential.json"),
    grantDir: grants,
    receiptDir: path.join(dir, "receipts"),
    artifactRoots: [artifacts],
    imageOrigins: ["https://images.example.com"],
    allowCreateContainers: true,
    allowPublish: true,
  };
  const write = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  write(config.credentialFile, {
    accessToken: "fixture-token",
    accountId: "123",
    expiresAt: "2026-10-24T12:00:00Z",
  });
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  fs.writeFileSync(artifacts + "/image.png", image);
  fs.writeFileSync(
    artifacts + "/copy.txt",
    "Approved exact copy https://example.com/",
  );
  const manifest = {
    operationId: "post-one",
    accountId: "123",
    textFile: artifacts + "/copy.txt",
    textSha256: hash(fs.readFileSync(artifacts + "/copy.txt")),
    ...(options.image
      ? {
          image: {
            file: artifacts + "/image.png",
            sha256: hash(image),
            url: "https://images.example.com/immutable.png",
            altText: "Approved exact alt text",
          },
        }
      : {}),
  };
  const file = artifacts + "/manifest.json";
  write(file, manifest);
  const args = {
    manifestFile: file,
    manifestSha256: hash(fs.readFileSync(file)),
  };
  const allow = {
    operationId: manifest.operationId,
    manifestSha256: args.manifestSha256,
    accountId: "123",
    actions: ["create_container", "publish"],
    notBefore: "2026-10-23T11:00:00Z",
    expiresAt: "2026-10-23T13:00:00Z",
    sourceRef: "fixture-human-approval",
  };
  write(grants + "/post-one.json", allow);
  const calls = [];
  let containerStatus = "FINISHED";
  let post = {
    id: "789",
    owner: { id: "123" },
    text: fs.readFileSync(manifest.textFile, "utf8"),
    media_type: options.image ? "IMAGE" : "TEXT_POST",
    permalink: "https://www.threads.com/@fixture/post/abc",
    ...(options.image
      ? {
          alt_text: manifest.image.altText,
          media_url: "https://cdn.example.com/transformed.jpg",
        }
      : {}),
  };
  let mode = "ok";
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    calls.push({
      path: url.pathname,
      method: req.method,
      body,
      auth: req.headers.authorization,
      fields: url.searchParams.get("fields"),
    });
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer fixture-token") {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    if (url.pathname === "/me") {
      res.end(
        JSON.stringify({
          id: mode === "wrong-account" ? "999" : "123",
          username: "fixture",
        }),
      );
      return;
    }
    if (url.pathname === "/123/threads") {
      if (mode === "create-unknown") {
        req.socket.destroy();
        return;
      }
      const data = new URLSearchParams(body);
      assert.equal(data.get("auto_publish_text"), null);
      assert.equal(data.get("text"), post.text);
      if (options.image) {
        assert.equal(data.get("image_url"), manifest.image.url);
        assert.equal(data.get("alt_text"), manifest.image.altText);
      }
      res.end(JSON.stringify({ id: "456" }));
      return;
    }
    if (url.pathname === "/456") {
      res.end(JSON.stringify({ id: "456", status: containerStatus }));
      return;
    }
    if (url.pathname === "/123/threads_publish") {
      assert.equal(new URLSearchParams(body).get("creation_id"), "456");
      containerStatus = "PUBLISHED";
      if (mode === "publish-unknown") {
        req.socket.destroy();
        return;
      }
      res.end(JSON.stringify({ id: "789" }));
      return;
    }
    if (url.pathname === "/789") {
      if (mode === "read-failed") {
        res.writeHead(503);
        res.end("{}");
        return;
      }
      res.end(JSON.stringify(post));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = async (url, init) =>
    String(url).startsWith("https://images.example.com/")
      ? new Response(
          mode === "image-changed" ? Buffer.from("changed") : image,
          { headers: { "content-type": "image/png" } },
        )
      : fetch(url, init);
  const client = createThreads(config, {
    fetchImpl,
    now,
    fixtureOrigin: origin,
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    config,
    args,
    manifest,
    allow,
    write,
    calls,
    client,
    now,
    origin,
    fetchImpl,
    setMode: (m) => {
      mode = m;
    },
    setStatus: (s) => {
      containerStatus = s;
    },
    setPost: (p) => {
      post = { ...post, ...p };
    },
    image,
  };
}
const writes = (f) => f.calls.filter((c) => c.method === "POST");
test("preparation is local and missing credentials is a structured blocker", async (t) => {
  const f = await fixture(t);
  fs.unlinkSync(f.config.credentialFile);
  const p = await f.client.call("threads_prepare", f.args);
  assert.equal(p.state, "prepared_locally");
  assert.equal(p.publicationAuthorized, false);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await f.client.call("threads_connection_status")).reason,
    "credentials_missing_or_invalid",
  );
});
test("text lifecycle verifies exact fields and replays without duplicate writes", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "ready",
  );
  const result = await f.client.call("threads_publish", f.args);
  assert.equal(result.state, "published_verified");
  assert.equal(result.postId, "789");
  assert.equal(result.permalink, "https://www.threads.com/@fixture/post/abc");
  assert.equal(writes(f).length, 2);
  const fresh = createThreads(f.config, {
    fetchImpl: f.fetchImpl,
    now: f.now,
    fixtureOrigin: f.origin,
  });
  assert.equal(
    (await fresh.call("threads_publish", f.args)).state,
    "published_verified",
  );
  assert.equal(
    (await fresh.call("threads_create_container", f.args)).state,
    "published_verified",
  );
  assert.equal(writes(f).length, 2);
});
test("single image checks hosted bytes and exact alt text; transformed provider bytes stay unknown", async (t) => {
  const f = await fixture(t, { image: true });
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "ready",
  );
  const r = await f.client.call("threads_publish", f.args);
  assert.equal(r.state, "published_verified");
  assert(r.verifiedFields.includes("alt_text"));
  assert.equal(
    r.imageBytesVerification,
    "input_hash_verified_provider_image_bytes_unverified",
  );
});
test("unapproved and disabled mutations never reach provider writes", async (t) => {
  const f = await fixture(t);
  const c = createThreads(
    { ...f.config, allowPublish: false, allowCreateContainers: false },
    { now: f.now, fixtureOrigin: f.origin },
  );
  assert.equal(
    (await c.call("threads_create_container", f.args)).reason,
    "container_creation_disabled",
  );
  fs.unlinkSync(f.config.grantDir + "/post-one.json");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "host_grant_missing",
  );
  assert.equal(writes(f).length, 0);
  assert.equal(
    (
      await f.client.call("threads_create_container", {
        ...f.args,
        approved: true,
      })
    ).reason,
    "input_invalid",
  );
});
test("expired credentials and wrong account fail before writes", async (t) => {
  const f = await fixture(t);
  f.write(f.config.credentialFile, {
    accessToken: "fixture-token",
    accountId: "123",
    expiresAt: "2026-10-23T11:00:00Z",
  });
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "credentials_expired",
  );
  f.write(f.config.credentialFile, {
    accessToken: "fixture-token",
    accountId: "123",
    expiresAt: "2026-10-24T12:00:00Z",
  });
  f.setMode("wrong-account");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "account_identity_mismatch",
  );
  assert.equal(writes(f).length, 0);
});
test("changed copy, manifest, host grant and image URL bytes fail closed", async (t) => {
  const f = await fixture(t, { image: true });
  assert.equal(
    (
      await f.client.call("threads_prepare", {
        ...f.args,
        manifestSha256: "0".repeat(64),
      })
    ).reason,
    "manifest_hash_mismatch",
  );
  f.write(f.config.grantDir + "/post-one.json", {
    ...f.allow,
    accountId: "999",
  });
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "host_grant_mismatch",
  );
  f.write(f.config.grantDir + "/post-one.json", f.allow);
  f.setMode("image-changed");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "public_image_hash_mismatch",
  );
  fs.appendFileSync(f.manifest.textFile, "unapproved");
  assert.equal(
    (await f.client.call("threads_prepare", f.args)).reason,
    "text_hash_mismatch",
  );
  assert.equal(writes(f).length, 0);
});
test("symlink artifacts escaping roots and overly long text are rejected", async (t) => {
  const f = await fixture(t);
  const outside = f.dir + "/outside.txt";
  fs.writeFileSync(outside, "outside");
  fs.unlinkSync(f.manifest.textFile);
  fs.symlinkSync(outside, f.manifest.textFile);
  assert.equal(
    (await f.client.call("threads_prepare", f.args)).reason,
    "artifact_outside_roots",
  );
  fs.unlinkSync(f.manifest.textFile);
  fs.writeFileSync(f.manifest.textFile, "é".repeat(251));
  f.manifest.textSha256 = hash(fs.readFileSync(f.manifest.textFile));
  f.write(f.args.manifestFile, f.manifest);
  f.args.manifestSha256 = hash(fs.readFileSync(f.args.manifestFile));
  assert.equal(
    (await f.client.call("threads_prepare", f.args)).reason,
    "text_outside_supported_limits",
  );
});
test("creation transport ambiguity persists and never recreates", async (t) => {
  const f = await fixture(t);
  f.setMode("create-unknown");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "creation_unknown",
  );
  f.setMode("ok");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "creation_unknown",
  );
  assert.equal(writes(f).length, 1);
});
test("publication transport ambiguity never republishes even when status later says finished", async (t) => {
  const f = await fixture(t);
  await f.client.call("threads_create_container", f.args);
  f.setMode("publish-unknown");
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "publish_unknown",
  );
  f.setMode("ok");
  f.setStatus("FINISHED");
  assert.equal(
    (await f.client.call("threads_reconcile", f.args)).state,
    "publish_unknown",
  );
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "publish_unknown",
  );
  assert.equal(writes(f).length, 2);
});
test("known published ID with failed readback reconciles without republishing", async (t) => {
  const f = await fixture(t);
  await f.client.call("threads_create_container", f.args);
  f.setMode("read-failed");
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "published_unverified",
  );
  f.setStatus("FINISHED");
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "published_unverified",
  );
  f.setMode("ok");
  assert.equal(
    (await f.client.call("threads_reconcile", f.args)).state,
    "published_verified",
  );
  assert.equal(writes(f).length, 2);
});
test("published text mismatch is recorded, never silently repaired or reissued", async (t) => {
  const f = await fixture(t);
  await f.client.call("threads_create_container", f.args);
  f.setPost({ text: "Wrong text" });
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "published_mismatch",
  );
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "published_mismatch",
  );
  assert.equal(writes(f).length, 2);
});
test("processing and expired containers never reach publish", async (t) => {
  const f = await fixture(t);
  f.setStatus("IN_PROGRESS");
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "processing",
  );
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "processing",
  );
  f.setStatus("EXPIRED");
  assert.equal(
    (await f.client.call("threads_reconcile", f.args)).state,
    "container_failed",
  );
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "container_failed",
  );
  assert.equal(writes(f).length, 1);
});
test("changed approval window blocks publish and concurrent operations share one effect", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.client.call("threads_create_container", f.args),
    f.client.call("threads_create_container", f.args),
  ]);
  assert(results.some((r) => r.state === "ready"));
  assert.equal(writes(f).length, 1);
  f.write(f.config.grantDir + "/post-one.json", {
    ...f.allow,
    expiresAt: "2026-10-23T11:00:00Z",
  });
  assert.equal(
    (await f.client.call("threads_publish", f.args)).reason,
    "host_grant_outside_window",
  );
  assert.equal(writes(f).length, 1);
});
test("stdio advertises five strict tools and returns missing-config blocker without secrets", async (t) => {
  const p = spawn(process.execPath, ["deploy/threads/main.mjs"], {
    env: { ...process.env, THREADS_CONFIG_FILE: "/missing-fixture-config" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => p.kill());
  const lines = readline.createInterface({ input: p.stdout });
  let next = 0;
  const pending = new Map();
  lines.on("line", (l) => {
    const x = JSON.parse(l);
    pending.get(x.id)?.(x);
    pending.delete(x.id);
  });
  const rpc = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++next;
      pending.set(id, resolve);
      p.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  assert((await rpc("initialize")).result.capabilities.tools);
  const listed = (await rpc("tools/list")).result.tools;
  assert.equal(listed.length, 5);
  assert(
    listed.every(
      (x) =>
        x.inputSchema.type === "object" &&
        x.inputSchema.additionalProperties === false,
    ),
  );
  const result = await rpc("tools/call", {
    name: "threads_connection_status",
    arguments: {},
  });
  assert.equal(
    JSON.parse(result.result.content[0].text).reason,
    "host_configuration_unavailable",
  );
  assert.equal(result.result.isError, true);
  p.stdin.end();
  lines.close();
});

test("grant revoked during image preflight prevents container creation", async (t) => {
  const f = await fixture(t, { image: true });
  const fetchImpl = async (url, init) => {
    const result = await f.fetchImpl(url, init);
    if (String(url).startsWith("https://images.example.com/")) {
      fs.unlinkSync(f.config.grantDir + "/post-one.json");
    }
    return result;
  };
  const client = createThreads(f.config, {
    fetchImpl,
    now: f.now,
    fixtureOrigin: f.origin,
  });
  assert.equal(
    (await client.call("threads_create_container", f.args)).reason,
    "host_grant_missing",
  );
  assert.equal(writes(f).length, 0);
});

test("a crashed operation lock is not stolen or treated as permission to retry", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(
    f.config.receiptDir + "/post-one.json.lock",
    JSON.stringify({ pid: 999999999 }),
    { mode: 0o600 },
  );
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).reason,
    "operation_busy_or_stale_lock",
  );
  assert.equal(writes(f).length, 0);
});

test("UTF-8 byte order mark is preserved in exact submitted copy", async (t) => {
  const f = await fixture(t);
  const text = "\ufeffExact approved copy";
  fs.writeFileSync(f.manifest.textFile, text);
  f.manifest.textSha256 = hash(fs.readFileSync(f.manifest.textFile));
  f.write(f.args.manifestFile, f.manifest);
  f.args.manifestSha256 = hash(fs.readFileSync(f.args.manifestFile));
  f.write(f.config.grantDir + "/post-one.json", {
    ...f.allow,
    manifestSha256: f.args.manifestSha256,
  });
  f.setPost({ text });
  assert.equal(
    (await f.client.call("threads_create_container", f.args)).state,
    "ready",
  );
  assert.equal(
    (await f.client.call("threads_publish", f.args)).state,
    "published_verified",
  );
});

async function stdioCall(t, configFile, name, args = {}) {
  const child = spawn(process.execPath, ["deploy/threads/main.mjs"], {
    env: { ...process.env, THREADS_CONFIG_FILE: configFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("stdio_timeout"));
    }, 5000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0);
        resolve(JSON.parse(output.trim()).result);
      } catch (error) {
        reject(error);
      }
    });
  });
  child.stdin.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }) + "\n",
  );
  return result;
}

test("stdio rejects relative, symlink, public, oversized, directory and artifact-root configurations", async (t) => {
  const f = await fixture(t);
  const file = f.dir + "/host-config.json";
  f.write(file, f.config);
  const link = f.dir + "/config-link.json";
  fs.symlinkSync(file, link);
  const publicFile = f.dir + "/public-config.json";
  f.write(publicFile, f.config);
  fs.chmodSync(publicFile, 0o644);
  const oversized = f.dir + "/oversized-config.json";
  fs.writeFileSync(oversized, " ".repeat(65537), { mode: 0o600 });
  const artifactConfig = f.config.artifactRoots[0] + "/host-config.json";
  f.write(artifactConfig, f.config);
  for (const configFile of [
    path.relative(process.cwd(), file),
    link,
    publicFile,
    oversized,
    f.dir,
    artifactConfig,
  ]) {
    const result = await stdioCall(t, configFile, "threads_prepare", f.args);
    assert.equal(result.isError, true);
    assert.equal(
      JSON.parse(result.content[0].text).reason,
      "host_configuration_unavailable",
    );
    assert(!JSON.stringify(result).includes(configFile));
  }
  assert.equal(f.calls.length, 0);
});

test("stdio accepts private host config, preserves disabled defaults and marks connector blockers as errors", async (t) => {
  const f = await fixture(t);
  const { allowCreateContainers, allowPublish, ...config } = f.config;
  assert.equal(allowCreateContainers, true);
  assert.equal(allowPublish, true);
  const file = f.dir + "/host-config.json";
  f.write(file, config);
  const prepared = await stdioCall(t, file, "threads_prepare", f.args);
  assert.equal(prepared.isError, false);
  assert.equal(JSON.parse(prepared.content[0].text).state, "prepared_locally");
  const blocked = await stdioCall(t, file, "threads_create_container", f.args);
  assert.equal(blocked.isError, true);
  assert.equal(
    JSON.parse(blocked.content[0].text).reason,
    "container_creation_disabled",
  );
  assert.equal(f.calls.length, 0);
});
