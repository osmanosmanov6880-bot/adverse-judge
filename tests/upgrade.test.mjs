import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {DEMOS,initialState,reduceEvent,comparison,funnelFromEvents,replay} from '../shared/domain.mjs';
import {backupDatabase} from '../scripts/backup.mjs';
import {verifyDatabase} from '../scripts/verify-db.mjs';
function fixture(t){const store=new Store(':memory:');t.after(()=>store.close());const svc=new JudgeService(store,{platforms:[{id:'A',name:'A',verified:false,mode:'clipboard'}]});return {store,svc};}
function cmd(s,extra={}){return {expectedVersion:s.version,commandId:randomUUID(),...extra};}
function finish(svc,owner='qa'){
 let r=svc.create(owner,{claim:DEMOS[0].claim,draft:DEMOS[0]});
 r=svc.act(owner,r.state.id,cmd(r.state,{action:'narrow'}));
 r=svc.prepare(owner,r.state.id,cmd(r.state,{draft:DEMOS[0]}));
 return svc.verdict(owner,r.state.id,cmd(r.state,{claim:r.state.candidates[0].text,acknowledged:true}));
}
test('owner can reopen issued verdict and issue a second version, retaining provenance',t=>{
 const {svc}=fixture(t);let r=finish(svc),id=r.state.id,old=r.state.verdictId;
 r=svc.reopen('qa',id,cmd(r.state));assert.equal(r.state.phase,'reopened');assert.equal(r.audit.consistent,true);
 r=svc.act('qa',id,cmd(r.state,{action:'reframe'}));
 r=svc.prepare('qa',id,cmd(r.state,{draft:DEMOS[0]}));
 r=svc.verdict('qa',id,cmd(r.state,{claim:'Новый вариант рекламы для небольшого бизнеса',acknowledged:true}));
 assert.equal(r.state.phase,'verdict');assert.notEqual(r.state.verdictId,old);
 assert.equal(r.events.filter(x=>x.type==='verdict_issued').length,2);
 assert.equal(r.audit.eventsChecked,r.state.version);assert.deepEqual(replay(r.events),r.state);
 const funnel=svc.analytics('qa');assert.equal(funnel.funnel[0].count,1);assert.equal(funnel.funnel[3].count,1);assert.equal(funnel.social.ownerReopened,1);
 assert.equal(funnel.series.reduce((n,x)=>n+x.verdicts,0),2);
});
test('manual revision invalidates old invitations and stale witness submissions',t=>{
 const {svc}=fixture(t);let r=finish(svc);const id=r.state.id;
 const invite=svc.invite('qa',id,cmd(r.state,{consent:true}));
 r=svc.reopen('qa',id,cmd(invite.state));
 assert.throws(()=>svc.publicInvite(invite.invite.token),x=>x.code==='EXPIRED');
 assert.throws(()=>svc.reopen('qa',id,cmd(r.state)),x=>x.code==='STATE');
});
test('event ledger audit blocks modifications after snapshot corruption',t=>{
 const {svc,store}=fixture(t);const r=finish(svc),id=r.state.id;
 const altered={...r.state,finalClaim:'Подменённая запись'};
 store.run('UPDATE cases SET state=? WHERE id=?',JSON.stringify(altered),id);
 assert.equal(svc.audit('qa',id).consistent,false);
 assert.throws(()=>svc.reopen('qa',id,cmd(altered)),x=>x.code==='INTEGRITY');
 assert.equal(store.one('SELECT COUNT(*) AS n FROM events WHERE case_id=?',id).n,r.events.length);
});
test('event ledger audit catches changed history even with unchanged snapshot',t=>{
 const {svc,store}=fixture(t);const r=finish(svc),id=r.state.id;
 store.run('UPDATE events SET data=? WHERE case_id=? AND type=?',JSON.stringify({claim:'Подменено',acknowledged:true}),id,'claim_rewritten');
 assert.equal(svc.audit('qa',id).consistent,false);
 assert.throws(()=>svc.handoff('qa',id,cmd(r.state,{platformId:'A'})),x=>x.code==='INTEGRITY');
});
test('risk comparison reports lexical signals only and cannot certify claims',()=>{
 const c=comparison('Лучший сервис: гарантируем 100% рост продаж','Создайте рекламный материал для бизнеса',{audience:'Небольшие компании'});
 assert.ok(c.before.length>c.after.length);assert.ok(c.resolved.length>0);
 assert.match(c.disclaimer,/не означает/);
 assert.ok(!Object.hasOwn(c,'legallyApproved'));
});
test('analytics counts unique cases per stage and separates internal from external outcomes',()=>{
 const t='2026-10-22T00:00:00.000Z';const e=(case_id,type)=>({case_id,type,at:t});
 const a=funnelFromEvents([e('a','case_created'),e('a','action_chosen'),e('a','action_chosen'),e('a','verdict_issued'),e('a','verdict_issued'),e('a','handoff_created'),e('b','case_created')],new Date(t));
 assert.equal(a.funnel[0].count,2);assert.equal(a.funnel[1].count,1);assert.equal(a.funnel[3].count,1);
 assert.equal(a.funnel[4].count,1);assert.equal(a.funnel[5].count,0);assert.equal(a.funnel[6].count,0);
 assert.equal(a.funnel[6].kind,'externally_confirmed');
 assert.equal(a.series.reduce((s,x)=>s+x.verdicts,0),2);
});
test('safely backs up WAL-mode SQLite, verifies replay, and never overwrites backups',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v02-backup-'));try{
  const input=join(dir,'live.sqlite'),output=join(dir,'backup.sqlite');
  const store=new Store(input);const svc=new JudgeService(store);
  finish(svc);const manifest=await backupDatabase(input,output);
  assert.equal(manifest.verification.ok,true);assert.equal(manifest.verification.casesChecked,1);
  assert.equal(verifyDatabase(output).ok,true);
  await assert.rejects(()=>backupDatabase(input,output),/already exists/);
  store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('read-only database verification detects integrity drift even when SQLite integrity check passes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v02-verify-'));try{
  const path=join(dir,'case.sqlite'),store=new Store(path),svc=new JudgeService(store),r=finish(svc);
  store.run('UPDATE cases SET state=? WHERE id=?',JSON.stringify({...r.state,phase:'hearing'}),r.state.id);
  store.close();const result=verifyDatabase(path);
  assert.equal(result.integrity,true);assert.equal(result.replayFailures,1);assert.equal(result.ok,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
