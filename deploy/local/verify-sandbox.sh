set -eu
test -e /.dockerenv
test "${OMB_SANDBOX_FIXTURE:-}" = 1
test ! -f /data/.openmausbot/bots.json
python --version
python3 --version
rg --version
test -x /usr/local/bin/claude-with-artifacts
test -x /usr/local/bin/newsletter-template-prepare
test -x /usr/local/bin/claude-design-mcp
test -x /usr/local/bin/slop-detector-mcp
mkdir -p /fixture/work /fixture/outside
chmod 777 /fixture/work /fixture/outside
cat > /fixture/probe.mjs <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import net from 'node:net';
fs.writeFileSync('allowed.txt','fixture');assert.equal(fs.readFileSync('allowed.txt','utf8'),'fixture');
let denied=false;try{fs.writeFileSync('/fixture/outside/denied.txt','unexpected')}catch(e){denied=['EACCES','EPERM','EROFS'].includes(e.code)}assert.equal(denied,true,'Outside workspace write must be denied');
const network=await new Promise(resolve=>{const s=net.createServer();s.on('error',e=>resolve(e.code));s.listen(0,'127.0.0.1',()=>{s.close();resolve('allowed')})});assert.ok(['EACCES','EPERM'].includes(network),String(network));
console.log(JSON.stringify({workspaceReadWrite:true,outsideWriteDenied:denied,networkDenied:network}));
JS
su -s /bin/sh maus -c 'cd /fixture/work; codex -c '\''sandbox_mode="workspace-write"'\'' sandbox -- node /fixture/probe.mjs'
test ! -e /fixture/outside/denied.txt
