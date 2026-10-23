import hashlib
import json
from pathlib import Path
import re
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def apply_patch(original, patch):
    lines = original.decode().splitlines(keepends=True)
    result = []
    cursor = 0
    position = None
    for line in patch.splitlines(keepends=True):
        if line.startswith(("--- ", "+++ ")):
            continue
        if line.startswith("@@ "):
            match = re.match(r"@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@", line)
            if not match:
                raise ValueError("Malformed patch header")
            position = int(match[1]) - 1
            if position < cursor:
                raise ValueError("Overlapping patch hunks")
            result.extend(lines[cursor:position])
            cursor = position
        elif position is not None and line[:1] in (" ", "-", "+"):
            if line[0] != "+":
                if cursor >= len(lines) or lines[cursor] != line[1:]:
                    raise ValueError(f"Patch mismatch at source line {cursor + 1}")
                cursor += 1
            if line[0] != "-":
                result.append(line[1:])
        else:
            raise ValueError("Unexpected patch content")
    result.extend(lines[cursor:])
    return "".join(result).encode()


def main():
    source, destination = map(Path, sys.argv[1:])
    here = Path(__file__).parent
    manifest = json.loads((here / "manifest.json").read_text())
    prepared = []
    for name, spec in manifest["files"].items():
        original = (source / name).read_bytes()
        if digest(original) != spec["before"]:
            raise ValueError(f"Unsupported base artifact: {name}")
        target = apply_patch(original, (here / spec["patch"]).read_text())
        if digest(target) != spec["after"]:
            raise ValueError(f"Patched artifact hash differs: {name}")
        path = destination / name
        if path.exists():
            raise ValueError(f"Destination already exists: {path}")
        prepared.append((path, target))
    for path, target in prepared:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(target)
    print(json.dumps({"prepared": [str(p) for p, _ in prepared]}))


if __name__ == "__main__":
    main()
