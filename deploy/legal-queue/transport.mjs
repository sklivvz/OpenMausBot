import { randomUUID } from 'node:crypto';
function need(ok,message){if(!ok)throw Error(message);}
export function createRpc({origin,token,fetchImpl=fetch}){
 need(origin&&token,'Managed connector configuration missing');const endpoint=new URL(origin.replace(/\/$/,'')+'/v1/mcp');need(endpoint.protocol==='https:'||['127.0.0.1','localhost'].includes(endpoint.hostname),'Connector requires HTTPS');
 return async(slug,args)=>{
  need(['TODOIST_GET_ALL_TASKS','TODOIST_UPDATE_TASK','TODOIST_CREATE_TASK','TODOIST_CLOSE_TASK_V1'].includes(slug),'Unsupported operation');
  const id=randomUUID();const r=await fetchImpl(endpoint,{method:'POST',signal:AbortSignal.timeout(30000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'COMPOSIO_MULTI_EXECUTE_TOOL',arguments:{tools:[{tool_slug:slug,account:'work',arguments:args}],sync_response_to_workbench:false}}})});
  need(r.ok,`Connector HTTP ${r.status}; inspect current task state before retrying`);const raw=await r.text();need(raw.length<2000000,'Connector response too large');
  const frame=raw.trim().startsWith('{')?JSON.parse(raw):raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5))}catch{return null}}).findLast(x=>x?.id===id);
  need(frame&&!frame.error&&!frame.result?.isError,'Connector rejected operation');const result=frame.result.structuredContent??frame.result.content.filter(x=>x.type==='text').map(x=>typeof x.text==='string'?JSON.parse(x.text):x.text).find(x=>x?.data);
  need(result?.successful!==false&&!result?.error&&!result?.data?.remote_file_info,'Incomplete connector response; use discovered connected-app tools');const row=result?.data?.results?.[0];need(row?.response?.successful===true&&!row.response.error,'Todoist operation failed');return row.response.data;
 };
}
