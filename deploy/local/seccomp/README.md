# Nested Codex sandbox on Docker Desktop

The local non-root app runs Codex 0.163.0. Its bubblewrap sandbox needs user and
mount namespaces. Docker's default seccomp profile denies these operations,
causing ordinary Ask/Auto file reads to fail before execution.

`docker-default.json` is Moby profiles commit
`4b8214fc4971e06172938a1f1554ccff6647ee80`, downloaded from
https://github.com/moby/profiles/blob/4b8214fc4971e06172938a1f1554ccff6647ee80/seccomp/default.json.
Its Apache 2.0 license is retained here. `build.mjs` derives `codex-nested.json`.

The added rules allow unshare, clone only with CLONE_NEWUSER set, mount, umount2
and pivot_root. Kernel namespace/capability checks still apply. No host admin
capability is added. Other default syscall restrictions remain, including the
network-family and kernel keyring restrictions. This increases the namespace
syscall surface inside the existing container; it does not remove seccomp or
change a bot's Ask/Auto/Full policy. The profile is qualified on Linux arm64
Docker Desktop; do not claim qualification for another architecture or host.

Regenerate with `node deploy/local/seccomp/build.mjs`. Qualify changes in a
throwaway container with no live data or credentials before use. Check allowed
workspace writes, denied writes to an otherwise writable outside directory,
and denied sandbox networking. The live app must be recreated to load a changed
profile. Drain existing executions first; retain the old image/config for rollback.

References: https://docs.docker.com/engine/security/seccomp/ and
https://learn.chatgpt.com/docs/agent-approvals-security.

Verified invocation:

```sh
docker run --rm -i --network none -e OMB_SANDBOX_FIXTURE=1 \
  --security-opt seccomp=deploy/local/seccomp/codex-nested.json \
  --user 0:0 --entrypoint /bin/sh openmausbot-local:runtime-tools-20261023 \
  -s < deploy/local/verify-sandbox.sh
```
