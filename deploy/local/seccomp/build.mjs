import fs from 'node:fs';
const source = new URL('./docker-default.json', import.meta.url);
const profile = JSON.parse(fs.readFileSync(source, 'utf8'));
profile.syscalls.push(
  { names: ['unshare'], action: 'SCMP_ACT_ALLOW' },
  { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 268435456, valueTwo: 268435456, op: 'SCMP_CMP_MASKED_EQ' }] },
  { names: ['mount', 'umount2', 'pivot_root'], action: 'SCMP_ACT_ALLOW' },
);
fs.writeFileSync(new URL('./codex-nested.json', import.meta.url), JSON.stringify(profile, null, 2) + '\n');
