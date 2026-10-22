import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';import {JudgeService} from '../server/service.mjs';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {verifyDatabase} from '../scripts/verify-db.mjs';
function tmp(t){const dir=mkdtempSync(join(tmpdir(),'judge-ledger-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'pilot.sqlite');}
test('tampering with matching event and case snapshot fails attestation even if replay matches',t=>{
 const db=new Store(':memory:');t.after(()=>db.close());const judge=new JudgeService(db);
 const r=judge.create('owner',{claim:'Здесь можно получить лучший продукт на рынке',draft:{product:'Demo'}});
 assert.equal(judge.audit('owner',r.state.id).consistent,true);
 const original=JSON.parse(db.one('SELECT data FROM events WHERE case_id=?',r.state.id).data);
 const revised={...original,claim:'Сервис помогает создавать рекламные материалы'};
 db.run('UPDATE events SET data=? WHERE case_id=?',JSON.stringify(revised),r.state.id);
 const state=JSON.parse(db.one('SELECT state FROM cases WHERE id=?',r.state.id).state);state.claim=revised.claim;
 db.run('UPDATE cases SET state=? WHERE id=?',JSON.stringify(state),r.state.id);
 assert.equal(judge.audit('owner',r.state.id).consistent,false);
 assert.equal(db.auditLedger(r.state.id).consistent,false);
});
test('key mismatch is refused instead of rewriting signatures',t=>{
 const file=tmp(t);const keyA='A'.repeat(42),keyB='B'.repeat(42);
 const db=new Store(file,{ledgerSecret:keyA});const svc=new JudgeService(db);
 const r=svc.create('owner',{claim:'Реклама, которая помогает открыть дело',draft:{product:'Demo'}});
 assert.equal(svc.audit('owner',r.state.id).consistent,true);db.close();
 assert.throws(()=>new Store(file,{ledgerSecret:keyB}),/Ledger key or algorithm mismatch/);
 const same=new Store(file,{ledgerSecret:keyA});assert.equal(same.auditLedger(r.state.id).consistent,true);same.close();
});
test('read-only database verification checks forged event ledger',t=>{
 const file=tmp(t);const db=new Store(file);const svc=new JudgeService(db),r=svc.create('owner',{claim:'Создайте новый рекламный материал для бренда',draft:{product:'Demo'}});
 db.close();assert.equal(verifyDatabase(file).ok,true);
 const dirty=new Store(file);dirty.run('UPDATE event_attestations SET digest=? WHERE event_id=(SELECT MIN(id) FROM events)', '0'.repeat(64));dirty.close();
 const result=verifyDatabase(file);assert.equal(result.ledgerFailures,1);assert.equal(result.ok,false);
});
test('attestations cover later commands, not just the initial case',t=>{
 const db=new Store(':memory:');t.after(()=>db.close());const j=new JudgeService(db);
 let r=j.create('owner',{claim:'Мы помогаем малому бизнесу делать рекламу',draft:{product:'Demo'}});
 r=j.act('owner',r.state.id,{commandId:randomUUID(),expectedVersion:r.state.version,action:'narrow'});
 assert.equal(j.audit('owner',r.state.id).consistent,true);
 assert.equal(db.one('SELECT COUNT(*) n FROM event_attestations WHERE case_id=?',r.state.id).n,2);
});
