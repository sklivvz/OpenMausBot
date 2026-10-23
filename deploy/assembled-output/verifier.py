#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

VERSION = "1.0.0"
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024
MAX_ITEMS = 100
TEXT_BOUNDARIES = {"address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul"}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.images = []
        self.text = []
        self.ids = set()
        self.excluded = []
        self.other_resources = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in TEXT_BOUNDARIES and not self.excluded:
            self.text.append("\n")
        if tag in ("script", "style"):
            self.excluded.append(tag)
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "a" and "href" in values:
            self.links.append(values["href"] or "")
        if tag == "img":
            self.images.append({"src": values.get("src", ""), "alt": values.get("alt")})
        if tag in ("style", "link", "source", "video", "svg") or "srcset" in values or "style" in values:
            self.other_resources = True

    def handle_endtag(self, tag):
        if self.excluded and self.excluded[-1] == tag:
            self.excluded.pop()
        if tag in TEXT_BOUNDARIES and not self.excluded:
            self.text.append("\n")

    def handle_data(self, data):
        if not self.excluded:
            self.text.append(data)


def object_fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError("Unexpected or missing manifest object")


def bounded_text(value, maximum=2000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("Expected nonempty bounded text")
    return value


def text_list(value):
    if not isinstance(value, list) or len(value) > MAX_ITEMS:
        raise ValueError("Expected a bounded list")
    return [bounded_text(item) for item in value]


def validate_manifest(value):
    object_fields(value, ("artifact", "requirements"))
    artifact = value.get("artifact")
    object_fields(artifact, ("id", "version", "sha256", "source_ref"))
    bounded_text(artifact.get("id"), 200)
    bounded_text(artifact.get("version"), 200)
    if not re.fullmatch(r"[a-f0-9]{64}", artifact.get("sha256", "")):
        raise ValueError("Expected exact artifact SHA-256")
    if "source_ref" in artifact:
        bounded_text(artifact["source_ref"])
    requirements = value.get("requirements", {})
    object_fields(requirements, ("required_text", "required_links", "required_images", "forbidden_text", "personalization", "allowed_unresolved"))
    for key in ("required_text", "required_links", "forbidden_text", "allowed_unresolved"):
        text_list(requirements.get(key, []))
    for key, fields in (("required_images", ("src", "alt")), ("personalization", ("name", "expected_text"))):
        entries = requirements.get(key, [])
        if not isinstance(entries, list) or len(entries) > MAX_ITEMS:
            raise ValueError("Expected a bounded list")
        for entry in entries:
            object_fields(entry, fields)
            for field in fields:
                if key == "required_images" and field == "alt":
                    if field in entry and (not isinstance(entry[field], str) or len(entry[field]) > 2000):
                        raise ValueError("Expected bounded image alt text")
                else:
                    bounded_text(entry.get(field))
    return artifact, requirements


def valid_url(value, ids, image=False):
    if not value or any(char.isspace() or ord(char) < 32 for char in value):
        return False
    if not image and value.startswith("#"):
        return value[1:] in ids
    try:
        parsed = urlsplit(value)
        if parsed.scheme in ("https", "http"):
            return bool(parsed.hostname) and parsed.username is None and parsed.password is None and (parsed.port is None or 0 < parsed.port <= 65535)
        if not image and parsed.scheme in ("mailto", "tel"):
            return bool(parsed.path)
        return image and parsed.scheme == "cid" and bool(parsed.path)
    except ValueError:
        return False


def verify(html_bytes, manifest):
    if not html_bytes or len(html_bytes) > MAX_HTML_BYTES:
        raise ValueError("Artifact is empty or exceeds the size limit")
    artifact, requirements = validate_manifest(manifest)
    actual_hash = digest(html_bytes)
    checks = []

    def add(name, status, detail, evidence=None):
        if evidence:
            evidence = {key: ({"indexes": value[:20], "total": len(value), "truncated": len(value) > 20} if isinstance(value, list) else value) for key, value in evidence.items()}
        checks.append({"id": name, "status": status, "detail": detail, **({"evidence": evidence} if evidence else {})})

    add("artifact_version", "pass" if actual_hash == artifact["sha256"] else "fail", "Compared exact file bytes with the requested version hash")
    if actual_hash == artifact["sha256"]:
        html = html_bytes.decode("utf-8", errors="strict")
        doc = Document()
        doc.feed(html)
        doc.close()
        text = " ".join("".join(doc.text).split())
        required = requirements.get("required_text", [])
        missing = [index for index, item in enumerate(required) if " ".join(item.split()) not in text]
        add("required_text", "fail" if missing else "pass" if required else "unknown", "Text-node presence after whitespace normalization; not visual visibility", {"missing_requirement_indexes": missing})
        forbidden = requirements.get("forbidden_text", [])
        found = [index for index, item in enumerate(forbidden) if item in html or " ".join(item.split()) in text]
        add("forbidden_text", "fail" if found else "pass" if forbidden else "unknown", "Only explicitly supplied forbidden strings are checked", {"found_requirement_indexes": found})
        required_links = requirements.get("required_links", [])
        missing_links = [index for index, item in enumerate(required_links) if item not in doc.links]
        add("required_links", "fail" if missing_links else "pass" if required_links else "unknown", "Exact decoded href match", {"missing_requirement_indexes": missing_links})
        def late_bound(value):
            tokens = re.findall(r"\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}", value)
            return bool(tokens) and all(token in requirements.get("allowed_unresolved", []) for token in tokens)
        invalid_links = [index for index, item in enumerate(doc.links) if not valid_url(item, doc.ids) and not late_bound(item)]
        late_links = sum(late_bound(item) for item in doc.links)
        add("link_targets", "fail" if invalid_links else "unknown" if late_links or not doc.links else "pass", "Absolute HTTP(S), mailto, tel or existing same-document fragment; no network requests", {"invalid_link_indexes": invalid_links, "count": len(doc.links), "late_bound_count": late_links})
        required_images = requirements.get("required_images", [])
        missing_images = [index for index, item in enumerate(required_images) if not any(image["src"] == item["src"] and ("alt" not in item or image["alt"] == item["alt"]) for image in doc.images)]
        add("required_images", "fail" if missing_images else "pass" if required_images else "unknown", "Exact img src and explicitly requested alt text", {"missing_requirement_indexes": missing_images})
        invalid_images = [index for index, item in enumerate(doc.images) if not valid_url(item["src"], doc.ids, image=True) and not late_bound(item["src"])]
        late_images = sum(late_bound(item["src"]) for item in doc.images)
        add("image_sources", "fail" if invalid_images else "unknown" if late_images or not doc.images else "pass", "Absolute HTTP(S) or cid syntax; availability and attachments not established", {"invalid_image_indexes": invalid_images, "count": len(doc.images), "late_bound_count": late_images})
        personalization = requirements.get("personalization", [])
        missing_personalization = [index for index, item in enumerate(personalization) if " ".join(item["expected_text"].split()) not in text]
        add("personalization", "fail" if missing_personalization else "pass" if personalization else "unknown", "Expected text in this single supplied rendered sample; does not test other recipients", {"missing_requirement_indexes": missing_personalization})
        tokens = re.findall(r"\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}", html)
        unexpected = sorted(set(tokens) - set(requirements.get("allowed_unresolved", [])))
        add("unresolved_tokens", "fail" if unexpected else "pass", "Liquid-style tokens must be resolved or explicitly allowed as provider-late-bound", {"unexpected_count": len(unexpected), "allowed_count": len(tokens) - sum(token in unexpected for token in tokens)})
        add("other_embedded_resources", "unknown", "CSS, srcset, SVG and other embedded resources require separate inspection" if doc.other_resources else "No secondary-resource markers detected; not a complete resource inventory")
    else:
        add("content_checks", "unknown", "Skipped because the artifact differs from the requested source version")
    add("reachability", "unknown", "No links or images were fetched; syntax is not reachability")
    add("visual_layout", "unknown", "No rendering or visual assessment performed")
    add("email_client_rendering", "unknown", "No email-client compatibility or deliverability test performed")
    return {"schema_version": 1, "verifier_version": VERSION, "artifact": {"id": artifact["id"], "version": artifact["version"], "sha256": actual_hash, "expected_sha256": artifact["sha256"], **({"source_ref": artifact["source_ref"]} if "source_ref" in artifact else {})}, "contract_sha256": digest(canonical(manifest)), "status": "failed" if any(check["status"] == "fail" for check in checks) else "needs_review", "checks": checks, "approval": "not_assessed", "publication_authorized": False}


def read_file(file, roots, maximum):
    resolved = Path(file).resolve(strict=True)
    if not resolved.is_file() or not any(resolved.is_relative_to(root) and resolved != root for root in roots):
        raise ValueError("Artifact must be a regular file inside a configured root")
    with resolved.open("rb") as handle:
        value = handle.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError("File exceeds size limit")
    return value


def run(arguments, roots):
    object_fields(arguments, ("artifact_file", "manifest_file"))
    manifest = json.loads(read_file(arguments["manifest_file"], roots, MAX_MANIFEST_BYTES))
    return verify(read_file(arguments["artifact_file"], roots, MAX_HTML_BYTES), manifest)


TOOL = {"name": "verify_assembled_output", "description": "Read exact local assembled HTML and a version-bound requirements manifest. Check text, link/image references and personalization without rewriting, rendering, network requests or approval. Returns failures and explicit unknown visual/reachability checks.", "inputSchema": {"type": "object", "properties": {"artifact_file": {"type": "string"}, "manifest_file": {"type": "string"}}, "required": ["artifact_file", "manifest_file"], "additionalProperties": False}}


def mcp(roots):
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 16000:
                raise ValueError("Request exceeds size limit")
            request = json.loads(line)
            if not isinstance(request, dict) or "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "assembled-output", "version": VERSION}}
            elif method == "tools/list":
                result = {"tools": [TOOL]}
            elif method == "ping":
                result = {}
            elif method == "tools/call":
                params = request.get("params", {})
                if params.get("name") != TOOL["name"]:
                    raise ValueError("Unknown tool")
                result = {"content": [{"type": "text", "text": json.dumps(run(params.get("arguments", {}), roots))}]}
            else:
                raise ValueError("Unknown method")
            response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
        except (ValueError, KeyError, TypeError, OSError):
            if not isinstance(request, dict) or "id" not in request:
                continue
            response = {"jsonrpc": "2.0", "id": request["id"], "result": {"isError": True, "content": [{"type": "text", "text": "Verification unavailable: check bounded UTF-8 artifact, manifest schema and configured file roots."}]}}
        print(json.dumps(response), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", action="append", required=True)
    parser.add_argument("--mcp", action="store_true")
    parser.add_argument("--artifact")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    roots = [Path(root).resolve(strict=True) for root in args.root]
    if args.mcp:
        mcp(roots)
    else:
        print(json.dumps(run({"artifact_file": args.artifact, "manifest_file": args.manifest}, roots), indent=2))


if __name__ == "__main__":
    main()
