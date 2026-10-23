import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteMcpClient } from '../../server/mcp-http.ts';
import { createServer } from './server.mjs';
import { remoteRun, PROJECT } from './queue.mjs';

test('native MCP and credential-free shell clients use the scoped service with complete paging', async () => {
  let tasks=Array.from({length:7},(_,i)=>({id:'task-'+i,project_id:PROJECT,content:'Synthetic '+i,priority:2,updated_at:'v1',description:'Original synthetic request'}));
  const events=[];
  const rpc=async(slug,args)=>{
    if(slug==='TODOIST_GET_ALL_TASKS')return {tasks:structuredClone(tasks),next_cursor:null};
    if(slug==='TODOIST_UPDATE_TASK'){Object.assign(tasks.find(t=>t.id===args.task_id),args,{updated_at:'v2'});return {};}
    throw Error('Unexpected operation '+slug);
  };
  const server=createServer({rpc,record:e=>events.push(e)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const client=new RemoteMcpClient({type:'http',url:origin+'/mcp',headers:{}});
  const signal=AbortSignal.timeout(10000);
  const callTool=args=>client.request('tools/call',args,signal);
  try{
    await client.initialize('isolated-fixture',signal);
    assert.equal((await client.request('tools/list',{},signal)).tools.length,4);
    const read=async args=>JSON.parse((await callTool({name:'legal_queue_snapshot',arguments:args})).content[0].text);
    const first=await read({});assert.equal(first.tasks.length,5);assert.equal(first.complete,false);
    const second=await read({cursor:first.nextCursor});assert.equal(second.tasks.length,2);assert.equal(second.complete,true);
    const result=await remoteRun('progress',{taskId:'task-0',expectedUpdatedAt:'v1',status:'in_progress',owner:'Fixture Luis',nextAction:'Prepare synthetic draft',evidence:'Synthetic revision 2'},{url:origin+'/queue'});
    assert.equal(result.changed,true);assert.equal(events.length,1);assert.ok(result.task.description.startsWith('Original synthetic request'));
    assert.equal((await callTool({name:'legal_queue_progress',arguments:{taskId:'task-0',project_id:'other'}})).isError,true);
    await assert.rejects(remoteRun('arbitrary-send',{}, {url:origin+'/queue'}),/Unknown/);
    assert.equal((await fetch(origin+'/queue',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'})).status,403);
  }finally{await client.close();await new Promise(resolve=>server.close(resolve));}
});
