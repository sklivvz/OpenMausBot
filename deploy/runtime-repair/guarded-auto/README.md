# Guarded Auto compatibility

This narrow patch adds explicit Auto-mode guarded messages to the deployed
`bill-briefing-compact-20261023` package. It does not change a task's mode, rules,
models or tools. It adds Auto to the accepted expected-mode schema and advertises
`guardedAuto: 1`; the existing exact-mode admission check remains in force.

Export the image's `/app/dist-server` into an isolated directory, then run
`python3 deploy/runtime-repair/guarded-auto/apply.py /absolute/package/path`.
The base and result hashes are required. Build a derived image from the actual
current image, replacing only `dist-server/index.js` with the verified result.
Never recreate an older configured image over a newer running one.

The guarded-message and objective-portfolio fixtures accept
`OMB_VERIFICATION_ENTRY=/absolute/package/path/index.js` and launch an isolated
fake-provider server using that exact package. The Auto case admits an already
Auto task only when explicitly requested, and refuses it after a downgrade.
The ordinary default remains strict Ask. Deployment requires a separate
quiescence check; source tests do not establish a deployed change.
