# Narrow package repair

The source implementation is in `server/`. These patches reproduce the narrow
repair applied to the existing local image without including unrelated source
or dependency changes from a full rebuild.

`manifest.json` pins the base image and both before/after file hashes.
`apply.py` accepts an extracted original `dist-server` directory and an empty
output directory. It verifies every source hash and patch context, prepares
both outputs, verifies their hashes, and refuses existing output files.

```sh
python3 deploy/runtime-repair/apply.py /path/to/original/dist-server /path/to/empty/output
```

Copy the resulting `index.js` and `drivers/agents-proxy.js` into a new image based
on the pinned base. Preserve the base image's entrypoint, ownership and other
files. Qualify the exact package with isolated fixtures using
`OMB_VERIFICATION_ENTRY=/absolute/package/index.js`. The
[release receipt](../../docs/verification/agentic-minimal-20261023.md) records
the installed image, evidence, known limits and rollback conditions.

This is not a patch for another upstream version. A future full build should
include the source changes and run the same fixtures instead of applying these
artifact patches to a different base.
