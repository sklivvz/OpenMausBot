import { createRpc } from '../legal-queue/transport.mjs';
export function createProgressRpc(options) {
  const origin = new URL(options.origin);
  if (origin.username || origin.password || origin.hash || origin.search || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) throw Error('Invalid progress connector origin');
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpc = createRpc({ ...options, fetchImpl: (url, init) => fetchImpl(url, { ...init, redirect: 'error' }) });
  return (slug, args) => {
    if (!['TODOIST_GET_ALL_TASKS', 'TODOIST_UPDATE_TASK'].includes(slug)) throw Error('Unsupported progress operation');
    return rpc(slug, args);
  };
}
