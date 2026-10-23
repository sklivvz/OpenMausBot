#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
package = Path(sys.argv[1]).resolve()
target = package / 'index.js'
if hashlib.sha256(target.read_bytes()).hexdigest() != manifest['before']:
    raise SystemExit('Refusing a different base package')
subprocess.run(['patch', '--batch', '-p0', '-i', str(root / manifest['patch'])], cwd=package, check=True)
if hashlib.sha256(target.read_bytes()).hexdigest() != manifest['after']:
    raise SystemExit('Patched package hash mismatch')
