import { describe, expect, it } from "vitest";

import {
  connectorOnlyDomain,
  connectorOnlyDomainsByBotSchema,
  connectorOnlyRefusal,
  connectorOnlyUrlHost,
  isConnectorOnlyHost,
  normalizeConnectorHost,
} from "./connector-only.ts";

const GOOGLE_DOCS = ["docs.google.com", "drive.google.com", "sheets.google.com", "slides.google.com"];

const opens = (url: string) => ({ name: "agent_browser_open", arguments: { url } });

describe("connector-only hosts", () => {
  it("accepts a domain, normalizing case and a trailing dot, and refuses anything that is not one", () => {
    expect(connectorOnlyDomain(" Docs.Google.COM. ")).toBe("docs.google.com");
    for (const bad of ["https://docs.google.com", "docs.google.com:443", "docs.google.com/document", "127.0.0.1", "localhost", "*", "*.google.com", "docs..google.com", "-docs.google.com"]) {
      expect(connectorOnlyDomain(bad), bad).toBeNull();
    }
  });

  it("refuses the exact host and every subdomain, with case and a trailing dot", () => {
    for (const host of ["docs.google.com", "DOCS.GOOGLE.COM", "docs.google.com.", "v2.docs.google.com", "a.b.docs.google.com."]) {
      expect(isConnectorOnlyHost(host, GOOGLE_DOCS), host).toBe(true);
    }
  });

  it("does not mistake a lookalike suffix, and leaves TinyURL and Google sign-in reachable", () => {
    for (const host of ["docs.google.com.attacker.example", "notdocs.google.com", "docs.google.com.br.example", "tinyurl.com", "www.tinyurl.com", "accounts.google.com", "myaccount.google.com"]) {
      expect(isConnectorOnlyHost(host, GOOGLE_DOCS), host).toBe(false);
    }
  });

  it("finds a connector-only host in each browser URL form, for docs, Drive files, Sheets and Slides", () => {
    for (const url of [
      "https://docs.google.com/document/d/abc/edit",
      "https://drive.google.com/file/d/abc/view",
      "https://sheets.google.com/spreadsheets/d/abc/edit",
      "https://slides.google.com/presentation/d/abc/edit",
      "https://v2.docs.google.com/document/d/abc",
      "DOCS.GOOGLE.COM./document/d/abc",
    ]) expect(connectorOnlyUrlHost(opens(url), GOOGLE_DOCS), url).not.toBeNull();
    for (const url of ["https://tinyurl.com/abc", "https://accounts.google.com/o/oauth2/v2/auth", "https://docs.google.com.attacker.example/document/d/abc"]) {
      expect(connectorOnlyUrlHost(opens(url), GOOGLE_DOCS), url).toBeNull();
    }
  });

  it("tells the model to use the matching MCP connector", () => {
    expect(connectorOnlyRefusal("docs.google.com")).toContain("docs.google.com");
    expect(connectorOnlyRefusal("docs.google.com")).toMatch(/MCP connector/);
  });
});

describe("browserEngine.connectorOnlyDomainsByBot", () => {
  it("accepts bot ids with validated domains and normalizes them", () => {
    const parsed = connectorOnlyDomainsByBotSchema.parse({ liz: ["Docs.Google.com."], scout: ["tinyurl.com"] });
    expect(parsed).toEqual({ liz: ["docs.google.com"], scout: ["tinyurl.com"] });
  });

  it("refuses a scheme, port, path, single label or an unreasonable map", () => {
    for (const value of ["https://docs.google.com", "docs.google.com:443", "docs.google.com/document", "localhost", "127.0.0.1", "*.google.com"]) {
      expect(connectorOnlyDomainsByBotSchema.safeParse({ liz: [value] }).success, value).toBe(false);
    }
    expect(connectorOnlyDomainsByBotSchema.safeParse({ "bad/id": ["docs.google.com"] }).success).toBe(false);
    expect(connectorOnlyDomainsByBotSchema.safeParse({ liz: Array.from({ length: 65 }, () => "docs.google.com") }).success).toBe(false);
  });

  it("reduces names the same way as the gate", () => {
    expect(normalizeConnectorHost(" Docs.Google.Com. ")).toBe("docs.google.com");
  });
});
