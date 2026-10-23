import fs from 'node:fs';
import path from 'node:path';

const perkUrl = 'https://mcp.perk.com/api/mcp/mcp';

export function createPerkCredentialProvider({ storeFile, appUrl = 'http://127.0.0.1:8799', serverName = 'perk-upstream', fetcher = fetch, now = Date.now }) {
  const app = new URL(appUrl);
  if (typeof storeFile !== 'string' || !path.isAbsolute(storeFile) || app.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(app.hostname) || app.username || app.password || app.pathname !== '/' || app.search || app.hash || !/^perk-[a-z0-9-]{1,24}$/.test(serverName)) throw new Error('Invalid Perk administration configuration');
  let refreshing;
  function read() {
    try {
      const stat = fs.lstatSync(storeFile);
      if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077)) throw new Error();
      const record = JSON.parse(fs.readFileSync(storeFile, 'utf8')).servers?.[serverName];
      if (record?.url !== perkUrl || record.state !== 'signed-in' || typeof record.tokens?.access !== 'string' || !record.tokens.access || /\s/.test(record.tokens.access) || !Number.isFinite(record.tokens.expiresAt)) throw new Error();
      return { access: record.tokens.access, expiresAt: record.tokens.expiresAt };
    } catch { throw new Error('Perk authorization is unavailable; sign in through the configured Perk upstream'); }
  }
  async function refresh() {
    let response;
    try {
      response = await fetcher(new URL(`/api/mcp/servers/${serverName}/test`, app), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error();
      await response.body?.cancel();
    } catch { throw new Error('Perk authorization renewal is unavailable through the local application'); }
    const credential = read();
    if (credential.expiresAt <= now() + 30000) throw new Error('Perk authorization expired; sign in through the configured Perk upstream');
    return credential;
  }
  return async () => {
    const credential = read();
    if (credential.expiresAt > now() + 90000) return credential;
    refreshing ??= refresh().finally(() => { refreshing = undefined; });
    return refreshing;
  };
}
