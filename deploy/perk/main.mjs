import { serve } from './stdio.mjs';
import { createPerkCredentialProvider } from '../connector-auth/native-mcp.mjs';
let native;
const credentialProvider = process.env.PERK_NATIVE_OAUTH_STORE ? async () => {
  native ??= createPerkCredentialProvider({ storeFile: process.env.PERK_NATIVE_OAUTH_STORE, appUrl: process.env.PERK_NATIVE_APP_URL, serverName: process.env.PERK_NATIVE_SERVER_NAME });
  return native();
} : undefined;
serve({ credentialProvider }).catch(() => { process.exitCode = 1; });
