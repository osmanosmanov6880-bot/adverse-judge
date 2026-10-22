import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {ComparisonService} from '../server/comparison.mjs';
import {DEMOS} from '../shared/domain.mjs';
import {randomUUID} from 'node:crypto';

test('v0.4 SQLite schema upgrades to v0.5 and preserves actual verdict and sessions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v05-upgrade-'));
 let store;
 try{
   const file=join(dir,'judge.sqlite');store=new Store(file);const svc=new JudgeService(store);
   let v=svc.create('pilot',{claim:DEMOS[0].claim,draft:DEMOS[0]});
   v=svc.act('pilot',v.state.id,{commandId:randomUUID(),expectedVersion:v.state.version,action:'narrow'});
   v=svc.prepare('pilot',v.state.id,{commandId:randomUUID(),expectedVersion:v.state.version,draft:DEMOS[0]});
   v=svc.verdict('pilot',v.state.id,{commandId:randomUUID(),expectedVersion:v.state.version,claim:'Готовые рекламные материалы для малого бизнеса',acknowledged:true});
   const snapshot=v.state;
   store.run('INSERT INTO sessions(id_hash,owner_id,csrf,expires_at,created_at,device_label,last_seen_at) VALUES(?,?,?,?,?,?,?)','fixedhash','pilot','csrf',Date.now()+10000,new Date().toISOString(),'Windows · Chrome',0);
   // Simulate the exact v0.4 storage schema: v3, no comparison tables.
   store.db.exec('DROP TABLE comparison_votes; DROP TABLE comparison_links; DROP TABLE comparisons; PRAGMA user_version=3');
   store.close();store=null;
   store=new Store(file);
   assert.equal(store.one('PRAGMA user_version').user_version,28);
   const svc2=new JudgeService(store),compare=new ComparisonService(svc2);svc2.comparison=compare;
   assert.deepEqual(svc2.own('pilot',snapshot.id),snapshot);
   assert.equal(svc2.audit('pilot',snapshot.id).consistent,true);
   assert.equal(store.one('SELECT owner_id FROM sessions WHERE id_hash=?','fixedhash').owner_id,'pilot');
   assert.equal(compare.summaries('pilot',snapshot.id).length,0);
   const started=compare.start('pilot',snapshot.id,{commandId:randomUUID(),expectedVersion:snapshot.version,consent:true});
   assert.equal(started.comparisons.length,1);assert.equal(started.audit.consistent,true);
   store.close();store=null;
   store=new Store(file);assert.equal(store.one('PRAGMA user_version').user_version,28);assert.equal(new JudgeService(store).audit('pilot',snapshot.id).consistent,true);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
