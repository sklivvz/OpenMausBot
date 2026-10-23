import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from verifier import MAX_HTML_BYTES, digest, read_file, verify


HTML = b'''<!doctype html><html><body><p>Hello Ada &amp; team</p><p>Exact approved copy.</p><a href="https://example.com/start?a=1&amp;b=2">Read more</a><img src="https://example.com/image.png" alt="Approved illustration"></body></html>'''


def manifest(html=HTML):
    return {"artifact": {"id": "fixture-newsletter", "version": "v1", "sha256": digest(html), "source_ref": "fixture:approved-version"}, "requirements": {"required_text": ["Exact approved copy."], "required_links": ["https://example.com/start?a=1&b=2"], "required_images": [{"src": "https://example.com/image.png", "alt": "Approved illustration"}], "forbidden_text": ["[INSERT COPY HERE]"], "personalization": [{"name": "Ada recipient sample", "expected_text": "Hello Ada & team"}]}}


def checks(receipt):
    return {item["id"]: item["status"] for item in receipt["checks"]}


class VerifierTests(unittest.TestCase):
    def test_valid_structure_never_claims_visual_or_delivery_approval(self):
        result = verify(HTML, manifest())
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["artifact"]["sha256"], digest(HTML))
        self.assertEqual(checks(result)["required_links"], "pass")
        self.assertEqual(checks(result)["personalization"], "pass")
        for name in ("reachability", "visual_layout", "email_client_rendering"):
            self.assertEqual(checks(result)[name], "unknown")
        self.assertFalse(result["publication_authorized"])

    def test_changed_source_skips_content_verification(self):
        result = verify(HTML.replace(b"Ada", b"Grace"), manifest())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(checks(result)["artifact_version"], "fail")
        self.assertEqual(checks(result)["content_checks"], "unknown")

    def test_missing_text_links_images_and_personalization_are_distinct(self):
        html = b"<html><body>Different content</body></html>"
        result = verify(html, manifest(html))
        for name in ("required_text", "required_links", "required_images", "personalization"):
            self.assertEqual(checks(result)[name], "fail")

    def test_script_style_and_comment_text_do_not_satisfy_copy(self):
        for wrapper in ("<script>{}</script>", "<style>{}</style>", "<!--{}-->"):
            html = wrapper.format("Exact approved copy.").encode()
            self.assertEqual(checks(verify(html, manifest(html)))["required_text"], "fail")

    def test_url_syntax_accepts_legitimate_targets_but_not_unsafe_or_relative(self):
        html = b'''<p id="part">Text</p><a href="#part">Jump</a><a href="mailto:team@example.com">Email</a><a href="tel:+123">Call</a><img src="cid:logo"><img src="file:///tmp/a.png"><a href="javascript:alert(1)">bad</a><a href="../local">bad</a><a href="#missing">bad</a>'''
        result = verify(html, manifest(html))
        by_id = {item["id"]: item for item in result["checks"]}
        self.assertEqual(by_id["link_targets"]["evidence"]["invalid_link_indexes"]["indexes"], [3, 4, 5])
        self.assertEqual(by_id["image_sources"]["evidence"]["invalid_image_indexes"]["indexes"], [1])

    def test_declared_decorative_alt_is_allowed_and_wrong_alt_fails(self):
        html = HTML.replace(b'alt="Approved illustration"', b'alt=""')
        spec = manifest(html)
        spec["requirements"]["required_images"][0]["alt"] = ""
        self.assertEqual(checks(verify(html, spec))["required_images"], "pass")
        self.assertEqual(checks(verify(html, manifest(html)))["required_images"], "fail")

    def test_unresolved_tokens_and_explicit_late_bound_exceptions(self):
        html = b'<p>Hello {{ contact.first_name }}</p><a href="{{ unsubscribe_link }}">Unsubscribe</a>'
        spec = manifest(html)
        self.assertEqual(checks(verify(html, spec))["unresolved_tokens"], "fail")
        spec["requirements"]["allowed_unresolved"] = ["{{ unsubscribe_link }}", "{{ contact.first_name }}"]
        self.assertEqual(checks(verify(html, spec))["unresolved_tokens"], "pass")
        self.assertEqual(checks(verify(html, spec))["link_targets"], "unknown")

    def test_only_explicit_forbidden_phrases_are_rejected(self):
        html = b'<p>Imagine what happens next. [INSERT COPY HERE]</p>'
        self.assertEqual(checks(verify(html, manifest(html)))["forbidden_text"], "fail")
        spec = manifest(html)
        spec["requirements"]["forbidden_text"] = ["Not present"]
        self.assertEqual(checks(verify(html, spec))["forbidden_text"], "pass")

    def test_manifest_change_invalidates_contract_identity(self):
        spec = manifest()
        initial = verify(HTML, spec)
        changed = copy.deepcopy(spec)
        changed["requirements"]["required_text"].append("New required material")
        result = verify(HTML, changed)
        self.assertNotEqual(initial["contract_sha256"], result["contract_sha256"])
        self.assertEqual(result["status"], "failed")

    def test_missing_requirements_are_unknown_not_pass(self):
        spec = {"artifact": manifest()["artifact"]}
        self.assertEqual(checks(verify(HTML, spec))["required_images"], "unknown")

    def test_strict_manifest_and_size_limits(self):
        spec = manifest()
        spec["requirements"]["required_texts"] = ["typo"]
        with self.assertRaises(ValueError):
            verify(HTML, spec)
        with self.assertRaises(ValueError):
            verify(b"x" * (MAX_HTML_BYTES + 1), manifest())

    def test_file_roots_block_symlink_escape(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            source = Path(outside) / "private.html"
            source.write_bytes(HTML)
            (Path(root) / "link.html").symlink_to(source)
            with self.assertRaises(ValueError):
                read_file(Path(root) / "link.html", [Path(root)], MAX_HTML_BYTES)

    def test_stdio_mcp_discovers_and_verifies_real_files_without_mutation(self):
        with tempfile.TemporaryDirectory() as root:
            artifact = Path(root) / "artifact.html"
            contract = Path(root) / "manifest.json"
            artifact.write_bytes(HTML)
            contract.write_text(json.dumps(manifest()))
            requests = [{"id": 1, "method": "initialize"}, {"id": 2, "method": "tools/list"}, {"id": 3, "method": "tools/call", "params": {"name": "verify_assembled_output", "arguments": {"artifact_file": str(artifact), "manifest_file": str(contract)}}}]
            response = subprocess.run([sys.executable, str(Path(__file__).with_name("verifier.py")), "--root", root, "--mcp"], input="\n".join(json.dumps(item) for item in requests) + "\n", text=True, capture_output=True, check=True)
            rows = [json.loads(line) for line in response.stdout.splitlines()]
            self.assertEqual(rows[1]["result"]["tools"][0]["name"], "verify_assembled_output")
            receipt = json.loads(rows[2]["result"]["content"][0]["text"])
            self.assertEqual(receipt["artifact"]["sha256"], digest(HTML))
            self.assertEqual(artifact.read_bytes(), HTML)
            self.assertEqual(set(item.name for item in Path(root).iterdir()), {"artifact.html", "manifest.json"})


if __name__ == "__main__":
    unittest.main()
