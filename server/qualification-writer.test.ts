import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestLeadDecision, recordQualification, type Entry } from './qualification-writer.ts';
const deal='11111111-1111-4111-8111-111111111111', list='22222222-2222-4222-8222-222222222222', entryId='33333333-3333-4333-8333-333333333333', decisionId='44444444-4444-4444-8444-444444444444', otherId='55555555-5555-4555-8555-555555555555';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true}))) });
async function fixture(decision='yes') {
 const root=await mkdtemp(join(tmpdir(),'qualification-writer-'));roots.push(root);await mkdir(join(root,'lead-qualification'));
 const row={id:decisionId,decision,input:{lead_id:deal},sufficiency:{ok:true,provider:'jev'},match:{ok:true,provider:'jev'}};
 await writeFile(join(root,'lead-qualification/decisions.jsonl'),JSON.stringify(row)+'\n');
 let value:Entry={id:{entry_id:entryId,list_id:list},parent_object:'deals',parent_record_id:deal,entry_values:{sales_stage:[{status:{title:'Lead'}}],icp_match:[]}};
 const entry=vi.fn(async()=>structuredClone(value));
 const patch=vi.fn(async(_list:string,_entry:string,values:Record<string,string>)=>{if(values.sales_stage)value.entry_values.sales_stage=[{status:{title:values.sales_stage}}];if(values.icp_match)value.entry_values.icp_match=[{option:{title:values.icp_match}}]});
 return {root,row,entry,patch,params:{decisionId,entryId},deps:{botFolder:root,listId:list,transport:{entry,patch},authorized:()=>true},set:(e:Entry)=>{value=e},get:()=>structuredClone(value)};
}
describe('bounded qualification recording',()=>{
 it('records Yes and Qualified together on only the matching entry, verifies and is idempotent',async()=>{const f=await fixture();expect(await recordQualification(f.params,f.deps)).toMatchObject({verified:true,icp_match:'Yes',sales_stage:'Qualified'});expect(f.patch).toHaveBeenCalledOnce();expect(f.patch).toHaveBeenCalledWith(list,entryId,{icp_match:'Yes',sales_stage:'Qualified'});await recordQualification(f.params,f.deps);expect(f.patch).toHaveBeenCalledOnce()});
 it('records No without changing stage or creating any notes',async()=>{const f=await fixture('no');expect(await recordQualification(f.params,f.deps)).toMatchObject({verified:true,icp_match:'No',sales_stage:'Lead'});expect(f.patch).toHaveBeenCalledWith(list,entryId,{icp_match:'No'})});
 it('refuses stale or non-Jev decisions without writes',async()=>{const f=await fixture();await writeFile(join(f.root,'lead-qualification/decisions.jsonl'),[f.row,{...f.row,id:otherId}].map((r)=>JSON.stringify(r)).join('\n')+'\n');await expect(recordQualification(f.params,f.deps)).rejects.toThrow('superseded');expect(f.patch).not.toHaveBeenCalled();await writeFile(join(f.root,'lead-qualification/decisions.jsonl'),JSON.stringify({...f.row,match:{ok:true,provider:'other'}})+'\n');await expect(latestLeadDecision(join(f.root,'lead-qualification/decisions.jsonl'),decisionId)).rejects.toThrow('Jev')});
 it('refuses wrong deal, other stages, expired authority, and changed entry',async()=>{for(const mode of ['wrong','won','expired','changed']){const f=await fixture();if(mode==='wrong'){let v=f.get();v.parent_record_id=otherId;f.set(v)}if(mode==='won'){let v=f.get();v.entry_values.sales_stage=[{status:{title:'Won'}}];f.set(v)}if(mode==='expired')f.deps.authorized=()=>false;if(mode==='changed')f.entry.mockImplementationOnce(async()=>f.get()).mockImplementationOnce(async()=>{let v=f.get();v.entry_values.sales_stage=[{status:{title:'Won'}}];return v});await expect(recordQualification(f.params,f.deps)).rejects.toThrow();expect(f.patch).not.toHaveBeenCalled()}});
 it('does not report success if readback differs',async()=>{const f=await fixture();f.patch.mockImplementationOnce(async()=>{});await expect(recordQualification(f.params,f.deps)).rejects.toThrow('readback')});
});
