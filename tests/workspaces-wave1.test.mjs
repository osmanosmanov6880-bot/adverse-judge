import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {WorkspaceService} from '../server/workspaces.mjs';

const uid=['owner','editor','reader','outsider'];
function fixture(t){
 const db=new Store(':memory:');t.after(()=>db.close());
 for(const id of uid)db.run('INSERT INTO users VALUES(?,?,?,?)',id,id+'@demo.invalid','fake','2026-10-22T00:00:00Z');
 const judge=new JudgeService(db),ws=new WorkspaceService(judge);
 return {db,judge,ws};
}
function createCase(judge,user='owner'){
 return judge.create(user,{claim:'Наша платформа помогает вашему бизнесу создавать рекламные кампании',draft:{product:'ADVERSE'}}).state.id;
}
test('workspace invitations are hashed, single-use and role-limited',t=>{
 const {db,ws}=fixture(t);const id=ws.create('owner',{name:'Мировая рекламная студия'}).id;
 const a=ws.issueInvite('owner',id,{role:'reviewer'});
 assert.equal(db.one('SELECT token_hash FROM workspace_invites').token_hash.includes(a.token),false);
 assert.equal(ws.inviteInfo(a.token).role,'reviewer');
 assert.equal(ws.accept('editor',a.token).role,'reviewer');
 assert.throws(()=>ws.accept('outsider',a.token),e=>e.code==='EXPIRED');
 assert.throws(()=>ws.issueInvite('editor',id,{role:'reviewer'}),e=>e.code==='FORBIDDEN');
});
test('unregistered guests cannot create workspaces or join them',t=>{
 const {ws}=fixture(t);const id=ws.create('owner',{name:'Design Council'}).id;
 const link=ws.issueInvite('owner',id,{role:'viewer'});
 assert.throws(()=>ws.create('guest',{name:'Sample team'}),e=>e.code==='ACCOUNT_REQUIRED');
 assert.throws(()=>ws.accept('guest',link.token),e=>e.code==='ACCOUNT_REQUIRED');
});
test('shared cases are private by default and only explicit case is visible',t=>{
 const {ws,judge}=fixture(t);const id=ws.create('owner',{name:'Campaign Studio'}).id;
 const cid=createCase(judge),other=createCase(judge);
 ws.accept('reader',ws.issueInvite('owner',id,{role:'viewer'}).token);
 assert.equal(ws.detail('reader',id).cases.length,0);
 assert.throws(()=>ws.detail('outsider',id),e=>e.code==='NOT_FOUND');
 assert.throws(()=>ws.share('reader',id,cid),e=>e.code==='FORBIDDEN');
 ws.share('owner',id,cid);
 assert.deepEqual(ws.detail('reader',id).cases.map(x=>x.id),[cid]);
 assert.notEqual(cid,other);
 assert.throws(()=>judge.own('reader',cid),e=>e.code==='NOT_FOUND');
});
test('reviewer can comment but not mutate foreign source case',t=>{
 const {ws,judge}=fixture(t);const id=ws.create('owner',{name:'Editorial Board'}).id,cid=createCase(judge);
 ws.share('owner',id,cid);
 ws.accept('editor',ws.issueInvite('owner',id,{role:'reviewer'}).token);
 const out=ws.comment('editor',id,{caseId:cid,comment:'Уточните, какие рекламные задачи решает инструмент.'});
 assert.ok(out.id);
 assert.equal(ws.detail('owner',id).reviews.length,1);
 assert.throws(()=>judge.own('editor',cid),e=>e.code==='NOT_FOUND');
 const next=ws.issueInvite('owner',id,{role:'viewer'});ws.accept('reader',next.token);
 assert.throws(()=>ws.comment('reader',id,{caseId:cid,comment:'This is a long enough review'}),e=>e.code==='FORBIDDEN');
});
test('unsharing a case hides it from workspace and deleting workspace cleans data',t=>{
 const {ws,db,judge}=fixture(t);const id=ws.create('owner',{name:'Research Guild'}).id,cid=createCase(judge);
 ws.share('owner',id,cid);ws.unshare('owner',id,cid);
 assert.equal(ws.detail('owner',id).cases.length,0);
 ws.deleteWorkspace('owner',id);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM workspace_members').n,0);
 assert.ok(judge.own('owner',cid));
});
test('user cleanup removes memberships and authored workspace records',t=>{
 const {ws,db}=fixture(t);const id=ws.create('owner',{name:'Team Owners'}).id;
 ws.accept('editor',ws.issueInvite('owner',id,{role:'reviewer'}).token);
 ws.cleanupUser('editor');db.run('DELETE FROM users WHERE id=?','editor');
 assert.equal(ws.detail('owner',id).members.length,1);
 ws.cleanupUser('owner');db.run('DELETE FROM users WHERE id=?','owner');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM workspaces').n,0);
});
