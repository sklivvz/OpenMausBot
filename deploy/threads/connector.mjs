import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const id = /^[a-zA-Z0-9_-]{1,100}$/;
const providerId = /^\d{1,40}$/;
const sha = /^[a-f0-9]{64}$/;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) =>
  object(x) && Object.keys(x).every((k) => keys.includes(k));
export const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
class Fault extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const requireValue = (condition, code) => {
  if (!condition) throw new Fault(code);
};
function privateFile(file, max = 65536) {
  const stat = fs.lstatSync(file);
  requireValue(
    stat.isFile() && stat.size <= max && !(stat.mode & 0o077),
    "private_file_invalid",
  );
  return fs.readFileSync(file);
}
function durable(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
function location(file) {
  return fs.existsSync(file)
    ? fs.realpathSync(file)
    : path.join(location(path.dirname(file)), path.basename(file));
}
async function bounded(response, maximum) {
  requireValue(response.body, "provider_response_missing");
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requireValue(length <= maximum, "response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function createThreads(
  raw,
  { fetchImpl = fetch, now = () => new Date(), fixtureOrigin } = {},
) {
  requireValue(
    exact(raw, [
      "accountId",
      "credentialFile",
      "grantDir",
      "receiptDir",
      "artifactRoots",
      "imageOrigins",
      "allowCreateContainers",
      "allowPublish",
    ]),
    "configuration_invalid",
  );
  requireValue(
    typeof raw.accountId === "string" &&
      providerId.test(raw.accountId) &&
      Array.isArray(raw.artifactRoots) &&
      raw.artifactRoots.length > 0 &&
      raw.artifactRoots.length <= 64,
    "configuration_invalid",
  );
  const roots = raw.artifactRoots.map((p) => fs.realpathSync(p));
  for (const file of [raw.credentialFile, raw.grantDir, raw.receiptDir]) {
    requireValue(
      typeof file === "string" && path.isAbsolute(file),
      "configuration_invalid",
    );
    const resolved = location(file);
    requireValue(
      !roots.some((r) => resolved === r || resolved.startsWith(r + path.sep)),
      "private_storage_inside_artifacts",
    );
  }
  requireValue(
    location(raw.grantDir) !== location(raw.receiptDir),
    "configuration_invalid",
  );
  const origins = (raw.imageOrigins ?? []).map((s) => {
    const u = new URL(s);
    requireValue(
      u.protocol === "https:" && u.origin === s && !u.username && !u.password,
      "image_origin_invalid",
    );
    return s;
  });
  requireValue(
    raw.allowPublish === undefined || typeof raw.allowPublish === "boolean",
    "configuration_invalid",
  );
  requireValue(
    raw.allowCreateContainers === undefined ||
      typeof raw.allowCreateContainers === "boolean",
    "configuration_invalid",
  );
  const origin = fixtureOrigin ?? "https://graph.threads.net";
  if (fixtureOrigin) {
    const u = new URL(fixtureOrigin);
    requireValue(
      u.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(u.hostname) &&
        u.origin === fixtureOrigin,
      "fixture_origin_invalid",
    );
  }
  fs.mkdirSync(raw.receiptDir, { recursive: true, mode: 0o700 });
  const artifact = (file, max) => {
    requireValue(
      typeof file === "string" && path.isAbsolute(file),
      "artifact_path_invalid",
    );
    const resolved = fs.realpathSync(file);
    requireValue(
      roots.some((r) => resolved.startsWith(r + path.sep)),
      "artifact_outside_roots",
    );
    const stat = fs.statSync(resolved);
    requireValue(stat.isFile() && stat.size <= max, "artifact_size_invalid");
    return fs.readFileSync(resolved);
  };
  const load = (file, expected) => {
    const bytes = artifact(file, 32000);
    requireValue(
      sha.test(expected) && hash(bytes) === expected,
      "manifest_hash_mismatch",
    );
    const m = JSON.parse(bytes.toString("utf8"));
    requireValue(
      exact(m, [
        "operationId",
        "accountId",
        "textFile",
        "textSha256",
        "image",
      ]) &&
        typeof m.operationId === "string" &&
        id.test(m.operationId) &&
        m.accountId === raw.accountId &&
        sha.test(m.textSha256),
      "manifest_invalid",
    );
    const textBytes = artifact(m.textFile, 2000);
    requireValue(hash(textBytes) === m.textSha256, "text_hash_mismatch");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(textBytes);
    requireValue(
      text.trim().length > 0 &&
        textBytes.length <= 500 &&
        !Array.from(text).some((c) => {
          const n = c.codePointAt(0);
          return n === 127 || (n < 32 && ![9, 10, 13].includes(n));
        }),
      "text_outside_supported_limits",
    );
    requireValue(
      (text.match(/https?:\/\//g) ?? []).length <= 5,
      "too_many_links",
    );
    if (m.image !== undefined) {
      const i = m.image;
      requireValue(
        exact(i, ["file", "sha256", "url", "altText"]) &&
          sha.test(i.sha256) &&
          typeof i.altText === "string" &&
          i.altText.trim().length > 0 &&
          Buffer.byteLength(i.altText) <= 1000,
        "image_manifest_invalid",
      );
      const u = new URL(i.url);
      requireValue(
        u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.hash &&
          origins.includes(u.origin),
        "image_url_not_allowed",
      );
      const bytes = artifact(i.file, 8 * 1024 * 1024);
      requireValue(hash(bytes) === i.sha256, "image_hash_mismatch");
      requireValue(
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
        "unsupported_image_format",
      );
    }
    return { manifest: m, manifestSha256: expected, text };
  };
  const credential = () => {
    let c;
    try {
      c = JSON.parse(privateFile(raw.credentialFile).toString());
    } catch {
      throw new Fault("credentials_missing_or_invalid");
    }
    requireValue(
      exact(c, ["accessToken", "accountId", "expiresAt"]) &&
        c.accountId === raw.accountId &&
        typeof c.accessToken === "string" &&
        c.accessToken.length > 0 &&
        !/\s/.test(c.accessToken),
      "credentials_missing_or_invalid",
    );
    requireValue(
      Number.isFinite(Date.parse(c.expiresAt)) &&
        Date.parse(c.expiresAt) > now().getTime() + 60000,
      "credentials_expired",
    );
    return c.accessToken;
  };
  const api = async (route, method = "GET", params = {}) => {
    const token = credential();
    const url = new URL(route, origin);
    if (method === "GET")
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(method === "POST"
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(method === "POST"
          ? { body: new URLSearchParams(params).toString() }
          : {}),
      });
    } catch {
      throw new Fault("provider_transport_failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Fault(
        response.status === 401 || response.status === 403
          ? "provider_auth_or_scope_failed"
          : response.status === 429
            ? "provider_rate_limited"
            : "provider_request_failed",
      );
    }
    let result;
    try {
      result = JSON.parse(
        (await bounded(response, 1024 * 1024)).toString("utf8"),
      );
    } catch (e) {
      throw e instanceof Fault ? e : new Fault("provider_response_invalid");
    }
    requireValue(object(result) && !result.error, "provider_response_invalid");
    return result;
  };
  const identity = async () => {
    const r = await api("/me", "GET", { fields: "id,username" });
    requireValue(
      r.id === raw.accountId && typeof r.username === "string",
      "account_identity_mismatch",
    );
    return { accountId: r.id, username: r.username };
  };
  const checkImage = async (input) => {
    if (!input.manifest.image) return;
    let response;
    try {
      response = await fetchImpl(input.manifest.image.url, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { accept: "image/png,image/jpeg" },
      });
    } catch {
      throw new Fault("public_image_unavailable");
    }
    requireValue(response.ok, "public_image_unavailable");
    const bytes = await bounded(response, 8 * 1024 * 1024);
    requireValue(
      hash(bytes) === input.manifest.image.sha256,
      "public_image_hash_mismatch",
    );
  };
  const grant = (input, action) => {
    requireValue(
      action === "publish"
        ? raw.allowPublish === true
        : raw.allowCreateContainers === true,
      action === "publish"
        ? "publishing_disabled"
        : "container_creation_disabled",
    );
    let g;
    try {
      g = JSON.parse(
        privateFile(
          path.join(raw.grantDir, input.manifest.operationId + ".json"),
        ).toString(),
      );
    } catch {
      throw new Fault("host_grant_missing");
    }
    requireValue(
      exact(g, [
        "operationId",
        "manifestSha256",
        "accountId",
        "actions",
        "notBefore",
        "expiresAt",
        "sourceRef",
      ]) &&
        g.operationId === input.manifest.operationId &&
        g.manifestSha256 === input.manifestSha256 &&
        g.accountId === raw.accountId &&
        Array.isArray(g.actions) &&
        g.actions.every((a) => ["create_container", "publish"].includes(a)) &&
        g.actions.includes(action) &&
        typeof g.sourceRef === "string" &&
        g.sourceRef.trim().length > 0,
      "host_grant_mismatch",
    );
    requireValue(
      Number.isFinite(Date.parse(g.notBefore)) &&
        Number.isFinite(Date.parse(g.expiresAt)) &&
        Date.parse(g.notBefore) <= now().getTime() &&
        Date.parse(g.expiresAt) > now().getTime(),
      "host_grant_outside_window",
    );
    return g;
  };
  const receiptPath = (op) => {
    requireValue(id.test(op), "operation_id_invalid");
    return path.join(raw.receiptDir, op + ".json");
  };
  const read = (op) => {
    const f = receiptPath(op);
    return fs.existsSync(f)
      ? JSON.parse(privateFile(f, 2 * 1024 * 1024).toString())
      : null;
  };
  const save = (r) => {
    r.updatedAt = now().toISOString();
    durable(receiptPath(r.operationId), r);
    return r;
  };
  const summary = (r) => ({
    operationId: r.operationId,
    state: r.state,
    manifestSha256: r.manifestSha256,
    accountId: r.accountId,
    containerId: r.containerId ?? null,
    postId: r.postId ?? null,
    permalink: r.permalink ?? null,
    reason: r.reason ?? null,
    verifiedFields: r.verifiedFields ?? [],
    imageBytesVerification: r.imageBytesVerification ?? "not_applicable",
    receiptFile: receiptPath(r.operationId),
    checkedAt: r.updatedAt,
  });
  const lock = async (op, run) => {
    const file = receiptPath(op) + ".lock";
    let fd;
    try {
      fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: now().toISOString() }),
      );
    } catch (e) {
      if (e.code === "EEXIST") throw new Fault("operation_busy_or_stale_lock");
      throw e;
    }
    try {
      return await run();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(file);
    }
  };
  const checkReceipt = (r, input) =>
    requireValue(
      r.accountId === raw.accountId &&
        r.manifestSha256 === input.manifestSha256 &&
        r.operationId === input.manifest.operationId,
      "operation_identity_conflict",
    );
  const containerStatus = async (r) => {
    const c = await api("/" + r.containerId, "GET", {
      fields: "id,status,error_message",
    });
    requireValue(
      c.id === r.containerId &&
        ["FINISHED", "IN_PROGRESS", "PUBLISHED", "ERROR", "EXPIRED"].includes(
          c.status,
        ),
      "container_response_invalid",
    );
    r.containerStatus = c.status;
    if (
      [
        "creating",
        "creation_unknown",
        "publishing",
        "publish_unknown",
      ].includes(r.state)
    )
      return save(r);
    r.state =
      c.status === "FINISHED"
        ? "ready"
        : c.status === "IN_PROGRESS"
          ? "processing"
          : c.status === "PUBLISHED"
            ? "publish_unknown"
            : "container_failed";
    return save(r);
  };
  const verify = async (r, input) => {
    const p = await api("/" + r.postId, "GET", {
      fields: "id,text,media_type,permalink,owner,alt_text,media_url",
    });
    const expectedType = input.manifest.image ? "IMAGE" : "TEXT_POST";
    const link = typeof p.permalink === "string" ? new URL(p.permalink) : null;
    const matches =
      p.id === r.postId &&
      p.owner?.id === raw.accountId &&
      p.text === input.text &&
      p.media_type === expectedType &&
      link?.protocol === "https:" &&
      [
        "www.threads.net",
        "threads.net",
        "www.threads.com",
        "threads.com",
      ].includes(link.hostname) &&
      !link.username &&
      !link.password;
    const imageMatches =
      !input.manifest.image ||
      (p.alt_text === input.manifest.image.altText &&
        typeof p.media_url === "string" &&
        p.media_url.startsWith("https://"));
    r.readback = {
      checkedAt: now().toISOString(),
      id: p.id,
      owner: p.owner,
      text: p.text,
      media_type: p.media_type,
      permalink: p.permalink,
      alt_text: p.alt_text,
      media_url: p.media_url,
    };
    r.state =
      matches && imageMatches ? "published_verified" : "published_mismatch";
    r.reason = matches && imageMatches ? null : "publication_readback_mismatch";
    r.permalink = matches ? p.permalink : null;
    r.verifiedFields =
      matches && imageMatches
        ? [
            "id",
            "owner",
            "text",
            "media_type",
            "permalink",
            ...(input.manifest.image ? ["alt_text", "media_present"] : []),
          ]
        : [];
    r.imageBytesVerification = input.manifest.image
      ? "input_hash_verified_provider_image_bytes_unverified"
      : "not_applicable";
    return save(r);
  };
  const prepare = async (args) => {
    requireValue(
      exact(args, ["manifestFile", "manifestSha256"]),
      "input_invalid",
    );
    const input = load(args.manifestFile, args.manifestSha256);
    return {
      state: "prepared_locally",
      operationId: input.manifest.operationId,
      accountId: raw.accountId,
      manifestSha256: input.manifestSha256,
      textSha256: input.manifest.textSha256,
      textBytes: Buffer.byteLength(input.text),
      kind: input.manifest.image ? "IMAGE" : "TEXT",
      imageSha256: input.manifest.image?.sha256 ?? null,
      remoteEffects: false,
      publicationAuthorized: false,
    };
  };
  const create = async (args) => {
    requireValue(
      exact(args, ["manifestFile", "manifestSha256"]),
      "input_invalid",
    );
    const input = load(args.manifestFile, args.manifestSha256);
    const op = input.manifest.operationId;
    return lock(op, async () => {
      let r = read(op);
      if (r) {
        checkReceipt(r, input);
        return summary(r);
      }
      grant(input, "create_container");
      await identity();
      await checkImage(input);
      const permission = grant(input, "create_container");
      r = save({
        operationId: op,
        accountId: raw.accountId,
        manifestSha256: input.manifestSha256,
        state: "creating",
        createdAt: now().toISOString(),
        authorizationSource: permission.sourceRef,
      });
      try {
        const c = await api("/" + raw.accountId + "/threads", "POST", {
          text: input.text,
          media_type: input.manifest.image ? "IMAGE" : "TEXT",
          ...(input.manifest.image
            ? {
                image_url: input.manifest.image.url,
                alt_text: input.manifest.image.altText,
              }
            : {}),
        });
        requireValue(providerId.test(c.id), "container_response_invalid");
        r.containerId = c.id;
        r.state = "processing";
        save(r);
      } catch (e) {
        r.state = "creation_unknown";
        r.reason = e instanceof Fault ? e.code : "provider_operation_failed";
        return summary(save(r));
      }
      try {
        return summary(await containerStatus(r));
      } catch (e) {
        r.reason = e instanceof Fault ? e.code : "provider_read_failed";
        return summary(save(r));
      }
    });
  };
  const publish = async (args) => {
    requireValue(
      exact(args, ["manifestFile", "manifestSha256"]),
      "input_invalid",
    );
    const input = load(args.manifestFile, args.manifestSha256);
    const op = input.manifest.operationId;
    return lock(op, async () => {
      let r = read(op);
      requireValue(r, "operation_not_created");
      checkReceipt(r, input);
      if (
        [
          "published_verified",
          "published_mismatch",
          "published_unverified",
          "publish_unknown",
          "publishing",
          "creation_unknown",
          "creating",
          "container_failed",
        ].includes(r.state)
      )
        return summary(r);
      const permission = grant(input, "publish");
      await identity();
      await checkImage(input);
      r = await containerStatus(r);
      if (r.state !== "ready") return summary(r);
      grant(input, "publish");
      r.state = "publishing";
      r.publishAuthorizationSource = permission.sourceRef;
      save(r);
      try {
        const p = await api("/" + raw.accountId + "/threads_publish", "POST", {
          creation_id: r.containerId,
        });
        requireValue(providerId.test(p.id), "publish_response_invalid");
        r.postId = p.id;
        r.state = "published_unverified";
        save(r);
      } catch (e) {
        r.state = "publish_unknown";
        r.reason = e instanceof Fault ? e.code : "provider_operation_failed";
        return summary(save(r));
      }
      try {
        return summary(await verify(r, input));
      } catch (e) {
        r.reason = e instanceof Fault ? e.code : "provider_read_failed";
        return summary(save(r));
      }
    });
  };
  const reconcile = async (args) => {
    requireValue(
      exact(args, ["manifestFile", "manifestSha256"]),
      "input_invalid",
    );
    const input = load(args.manifestFile, args.manifestSha256);
    return lock(input.manifest.operationId, async () => {
      let r = read(input.manifest.operationId);
      requireValue(r, "operation_not_created");
      checkReceipt(r, input);
      await identity();
      if (r.postId) return summary(await verify(r, input));
      if (r.containerId) return summary(await containerStatus(r));
      return summary(r);
    });
  };
  return {
    async call(name, args = {}) {
      try {
        if (name === "threads_prepare") return await prepare(args);
        if (name === "threads_create_container") return await create(args);
        if (name === "threads_publish") return await publish(args);
        if (name === "threads_reconcile") return await reconcile(args);
        if (name === "threads_connection_status") {
          requireValue(exact(args, []), "input_invalid");
          return {
            state: "connected",
            ...(await identity()),
            containerCreationEnabled: raw.allowCreateContainers === true,
            publishingEnabled: raw.allowPublish === true,
          };
        }
        throw new Fault("tool_unknown");
      } catch (e) {
        return {
          state: "blocked",
          reason:
            e instanceof Fault
              ? e.code
              : "local_configuration_or_artifact_failure",
          remoteOutcome: "consult_existing_operation_receipt",
          retryPublication: false,
        };
      }
    },
  };
}
const fileArgs = {
  type: "object",
  properties: {
    manifestFile: { type: "string" },
    manifestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["manifestFile", "manifestSha256"],
  additionalProperties: false,
};
export const toolDefinitions = [
  {
    name: "threads_connection_status",
    description:
      "Read authenticated Threads identity and configured write switches. Missing/expired credentials are explicit blockers.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "threads_prepare",
    description:
      "Validate an exact text or single-image manifest locally. No provider mutation and no publication authority.",
    inputSchema: fileArgs,
  },
  {
    name: "threads_create_container",
    description:
      "Create one non-published Threads container under a host-issued exact-content grant. Durable operation identity prevents blind retries.",
    inputSchema: fileArgs,
  },
  {
    name: "threads_publish",
    description:
      "Publish the existing ready container only under a current host-issued exact-content grant; verify provider fields and permalink. Never retry an ambiguous publish.",
    inputSchema: fileArgs,
  },
  {
    name: "threads_reconcile",
    description:
      "Read existing container/publication state without another publish. Unknown outcomes remain unknown; image bytes after provider transformation are unverified.",
    inputSchema: fileArgs,
  },
];
