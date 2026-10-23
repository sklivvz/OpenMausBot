import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const PROJECT='6hjrcrRM8XH9hVJQ';
const marker='\n\n[Legal progress]\n';
const states=new Set(['ready','in_progress','in_review','waiting_external','waiting_user','held','done']);
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
export async function remoteRun(command,input,{url='http://127.0.0.1:8797/queue',fetchImpl=fetch}={}){
 const response=await fetchImpl(url,{method:'POST',signal:AbortSignal.timeout(300000),headers:{'content-type':'application/json'},body:JSON.stringify({command,input})});
 const result=await response.json();need(response.ok&&result.ok!==false,result.error??'Legal queue service unavailable');return result;
}
export async function run(command,input,{rpc,now=()=>new Date().toISOString(),record=()=>{}}){
 const get=async()=>{
  const tasks=[], cursors=new Set(), ids=new Set();let cursor;
  for(let page=0;page<100;page++){
   const data=await rpc('TODOIST_GET_ALL_TASKS',{limit:5,...(cursor?{cursor}:{})});
   need(Array.isArray(data?.tasks),'Incomplete Todoist task page');
   for(const task of data.tasks){need(typeof task.id==='string'&&typeof task.project_id==='string'&&!ids.has(task.id),'Invalid or overlapping task pages; reread before writing');ids.add(task.id);if(task.project_id===PROJECT)tasks.push(task);}
   if(!data.next_cursor){need(!data.has_more,'Incomplete task pagination');return {project:{id:PROJECT},tasks,sections:[...new Set(tasks.map(t=>t.section_id).filter(Boolean))].map(id=>({id}))};}
   need(typeof data.next_cursor==='string'&&!cursors.has(data.next_cursor),'Repeated Todoist cursor');cursors.add(data.next_cursor);cursor=data.next_cursor;
  }
  throw Error('Todoist page limit exceeded; no complete snapshot available');
 };
 const before=await get();
 if(command==='snapshot')return {checkedAt:now(),project:{id:PROJECT,name:before.project.name},tasks:before.tasks.sort((a,b)=>b.priority-a.priority||(a.due?.date??'9999').localeCompare(b.due?.date??'9999')).map(t=>({id:t.id,title:t.content,priority:t.priority,due:t.due,deadline:t.deadline,updatedAt:t.updated_at,description:t.description})),note:'Order is priority then due date. Check explicit deadlines, holds, dependencies and actual bot activity before choosing work.'};
 if(command==='add'){
  need(typeof input.source==='string'&&input.source.length>5,'Stable source required');need(typeof input.title==='string'&&input.title.length>3,'Task title required');need(typeof input.description==='string'&&input.description.length>10,'Task brief required');need(Number.isInteger(input.priority)&&input.priority>=1&&input.priority<=4,'Priority must be 1 to 4');
  const source='Legal source: '+input.source;const match=before.tasks.filter(t=>(t.description??'').includes(source)||t.content===input.title);need(match.length<=1,'Multiple possible duplicates; reconcile before adding');if(match.length)return {created:false,task:match[0]};
  if(input.sectionId)need(before.sections.some(s=>s.id===input.sectionId),'Unknown Legal section');
  await rpc('TODOIST_CREATE_TASK',{project_id:PROJECT,content:input.title,description:input.description+'\n\n'+source,priority:input.priority,...(input.sectionId?{section_id:input.sectionId}:{})});
  const after=await get();const task=after.tasks.find(t=>(t.description??'').includes(source));need(task,'Created task not confirmed; inspect before retrying');record({at:now(),action:'add',taskId:task.id,source:input.source});return {created:true,task};
 }
 need(['progress','complete'].includes(command),'Use snapshot, progress, add or complete');
 const task=before.tasks.find(t=>t.id===input.taskId);need(task,'Task is not open in Legal; inspect its current state');need(input.expectedUpdatedAt===task.updated_at,'Task changed; read current snapshot and merge');need(typeof input.evidence==='string'&&input.evidence.length>8,'Specific evidence or artifact reference required');
 if(command==='complete'){
  need(input.confirmAcceptance===true,'Confirm the task acceptance criteria are met');need(!task.due?.is_recurring,'Recurring task completion requires its normal connected-app workflow');need(!before.tasks.some(t=>t.parent_id===task.id),'Open subtasks remain');
  await rpc('TODOIST_CLOSE_TASK_V1',{task_id:task.id});const after=await get();need(!after.tasks.some(t=>t.id===task.id),'Completion was not confirmed');record({at:now(),action:'complete',taskId:task.id,evidence:input.evidence});return {completed:true,taskId:task.id,evidence:input.evidence};
 }
 need(states.has(input.status)&&input.status!=='done','Use a working state; use complete after acceptance');need(typeof input.owner==='string'&&input.owner.length>0,'Owner required');need(typeof input.nextAction==='string'&&input.nextAction.length>3,'Concrete next action required');
 const details={status:input.status,owner:input.owner,nextAction:input.nextAction,evidence:input.evidence,blocker:input.blocker??null,followUp:input.followUp??null};
 const existing=(task.description??'').split(marker);
 const lines=[`Status: ${details.status}`,`Owner: ${details.owner}`,`Next action: ${details.nextAction}`,`Evidence: ${details.evidence}`,`Blocker: ${details.blocker??'None'}`,`Follow-up: ${details.followUp??'Not set'}`].join('\n');
 const previous=(existing[1]??'').replace(/\nUpdated: [^\n]*$/,'');
 if(previous===lines&&(!input.title||input.title===task.content))return {changed:false,task};
 const description=existing[0]+marker+lines+'\nUpdated: '+now();need(description.length<16000,'Description too long; compact evidence before updating');
 await rpc('TODOIST_UPDATE_TASK',{task_id:task.id,description,...(input.title?{content:input.title}:{})});const saved=(await get()).tasks.find(t=>t.id===task.id);need(saved?.description===description&&(!input.title||saved.content===input.title),'Readback mismatch; inspect before retrying');
 record({at:now(),action:'progress',taskId:task.id,...details});return {changed:true,task:saved};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const command=process.argv[2];const home=path.dirname(process.argv[1]);const lock=path.join(home,'.queue-write-lock');let locked=false;
 try{
  if(command!=='snapshot'){try{fs.mkdirSync(lock);locked=true;}catch{throw Error('Another Legal queue write owns the lock; inspect its process before removing a stale lock');}}
  const input=command==='snapshot'?{}:JSON.parse(fs.readFileSync(0,'utf8'));
  const result=process.env.OMB_COMPOSIO_BROKER_URL&&process.env.OMB_COMPOSIO_BROKER_TOKEN
   ? await run(command,input,{rpc:createRpc({origin:process.env.OMB_COMPOSIO_BROKER_URL,token:process.env.OMB_COMPOSIO_BROKER_TOKEN}),record:e=>fs.appendFileSync(path.join(home,'queue-events.jsonl'),JSON.stringify(e)+'\n',{mode:0o600})})
   : await remoteRun(command,input);console.log(JSON.stringify(result,null,2));
 }catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}finally{if(locked)fs.rmdirSync(lock);}
}
