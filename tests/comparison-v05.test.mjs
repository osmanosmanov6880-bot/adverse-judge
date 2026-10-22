import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {ComparisonService} from '../server/comparison.mjs';
import {createApp} from '../server/index.mjs';
import {DEMOS,replay} from '../shared/domain.mjs';
const cmd=(s,rest={})=>({commandId:randomUUID(),expectedVersion:s.version,...rest});
function fixture(t,clock=()=>Date.now()){
 const store=new Store(':memory:');t.after(()=>store.close());const svc=new JudgeService(store,{clock});const compare=new ComparisonService(svc);svc.comparison=compare;return {store,svc,compare};
}
function verdict(svc,owner='owner'){
 let r=svc.create(owner,{claim:DEMOS[0].claim,draft:DEMOS[0]});const id=r.state.id;
 r=svc.act(owner,id,cmd(r.state,{action:'narrow'}));
 r=svc.prepare(owner,id,cmd(r.state,{draft:DEMOS[0]}));
 return svc.verdict(owner,id,cmd(r.state,{claim:'Создавайте рекламный материал для малого бизнеса.',acknowledged:true}));
}
function start(svc,compare,owner='owner'){
 const r=verdict(svc,owner);return compare.start(owner,r.state.id,cmd(r.state,{consent:true}));
}
function invite(svc,compare,r,owner='owner'){
 return compare.invite(owner,r.state.id,cmd(r.state,{comparisonId:r.comparisonId??r.comparisons?.[0]?.id}));
}
test('blind comparison starts only for an approved verdict, and only with consent',t=>{
 const {svc,compare}=fixture(t);
 const draft=svc.create('owner',{claim:DEMOS[0].claim,draft:DEMOS[0]});
 assert.throws(()=>compare.start('owner',draft.state.id,cmd(draft.state,{consent:true})),e=>e.code==='STATE');
 const v=verdict(svc);
 assert.throws(()=>compare.start('owner',v.state.id,cmd(v.state,{})),e=>e.code==='CONSENT');
 const a=compare.start('owner',v.state.id,cmd(v.state,{consent:true}));
 assert.equal(a.comparisons.length,1);assert.equal(a.comparisons[0].status,'open');
 assert.equal(a.comparisons[0].counts.total,0);assert.ok(a.audit.consistent);
 assert.equal(a.events.at(-1).type,'comparison_started');
});
test('repeated comparison commands are idempotent and version conflicts cannot create extra studies',t=>{
 const {svc,compare,store}=fixture(t),v=verdict(svc);
 const body=cmd(v.state,{consent:true}),first=compare.start('owner',v.state.id,body),second=compare.start('owner',v.state.id,body);
 assert.equal(second.duplicate,true);assert.equal(store.one('SELECT COUNT(*) AS n FROM comparisons').n,1);
 assert.throws(()=>compare.start('owner',v.state.id,cmd(v.state,{consent:true})),e=>e.code==='VERSION_CONFLICT');
 assert.equal(first.comparisons.length,1);
});
test('owner isolation protects studies, notes, and invites',t=>{
 const {svc,compare}=fixture(t),r=start(svc,compare);
 assert.throws(()=>compare.summaries('stranger',r.state.id),e=>e.code==='NOT_FOUND');
 assert.throws(()=>compare.invite('stranger',r.state.id,cmd(r.state,{comparisonId:r.comparisonId})),e=>e.code==='NOT_FOUND');
 assert.throws(()=>compare.close('stranger',r.state.id,cmd(r.state,{comparisonId:r.comparisonId})),e=>e.code==='NOT_FOUND');
 assert.throws(()=>compare.invite('owner',r.state.id,cmd(r.state,{comparisonId:randomUUID()})),e=>e.code==='NOT_FOUND');
});
test('individual links use secure token hashes and alternate display order',t=>{
 const {svc,compare,store}=fixture(t);let r=start(svc,compare);const tokens=[];
 for(let i=0;i<6;i++){
  const out=invite(svc,compare,r);r=out;tokens.push(out.comparisonInvite.token);
 }
 assert.equal(new Set(tokens).size,6);
 const orders=tokens.map(raw=>{const d=compare.public(raw);return d.first===r.comparisons[0].variantA?'ab':'ba';});
 assert.equal(orders.filter(x=>x==='ab').length,3);assert.equal(orders.filter(x=>x==='ba').length,3);
 const dbStrings=JSON.stringify(store.all('SELECT * FROM comparison_links'));
 assert.ok(!tokens.some(t=>dbStrings.includes(t)),'tokens only appear once to owner');
 assert.ok(!JSON.stringify(r).includes(tokens[0]));
});
test('participant can give one answer with a reason; canonical choice is preserved across display order',t=>{
 const {svc,compare,store}=fixture(t);let r=start(svc,compare);
 const first=invite(svc,compare,r);r=first;
 const d=compare.public(first.comparisonInvite.token);
 assert.ok(d.disclosure.includes('регистрация не нужна'));
 const accepted=compare.vote('friend',first.comparisonInvite.token,{choice:'first',note:'Первый текст короче и читается сразу.',accepted:true});
 assert.equal(accepted.ok,true);
 assert.throws(()=>compare.public(first.comparisonInvite.token),e=>e.code==='USED');
 assert.throws(()=>compare.vote('friend',first.comparisonInvite.token,{choice:'second',note:'',accepted:true}),e=>e.code==='USED');
 const answer=store.one('SELECT selection,note FROM comparison_votes');
 assert.equal(answer.selection,d.first===r.comparisons[0].variantA?'a':'b');
 assert.equal(svc.audit('owner',r.state.id).consistent,true);
 assert.equal(compare.summaries('owner',r.state.id)[0].counts.total,1);
 assert.equal(svc.detail('owner',r.state.id).events.at(-1).type,'comparison_voted');
});
test('author cannot vote using their own current session; other guest cannot read private results',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);r=invite(svc,compare,r);
 assert.throws(()=>compare.vote('owner',r.comparisonInvite.token,{choice:'first',accepted:true}),e=>e.code==='SELF_VOTE');
 assert.throws(()=>compare.summaries('visitor',r.state.id),e=>e.code==='NOT_FOUND');
 const publicFields=JSON.stringify(compare.public(r.comparisonInvite.token));
 assert.ok(!publicFields.includes('variant_a'));
 assert.ok(!publicFields.includes('counts'));
 assert.ok(!publicFields.includes('product'));
});
test('invalid selection, overly long notes and missing consent are blocked without consuming the link',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);r=invite(svc,compare,r);const raw=r.comparisonInvite.token;
 assert.throws(()=>compare.vote('friend',raw,{choice:'left',accepted:true}),e=>e.code==='VALIDATION');
 assert.throws(()=>compare.vote('friend',raw,{choice:'first',accepted:false}),e=>e.code==='CONSENT');
 assert.throws(()=>compare.vote('friend',raw,{choice:'first',note:'x'.repeat(501),accepted:true}),e=>e.code==='VALIDATION');
 assert.ok(compare.public(raw).first);
 assert.equal(compare.vote('friend',raw,{choice:'neither',accepted:true}).ok,true);
 assert.equal(compare.summaries('owner',r.state.id)[0].counts.neither,1);
});
test('closing comparison rejects all outstanding links and preserves real choices',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);let first=invite(svc,compare,r);r=first;
 const used=first.comparisonInvite.token;
 compare.vote('friend',used,{choice:'neither',accepted:true});
 r=svc.detail('owner',r.state.id);const pending=invite(svc,compare,r);r=pending;
 const closed=compare.close('owner',r.state.id,cmd(r.state,{comparisonId:r.comparisonId??r.comparisons?.[0]?.id}));
 assert.equal(closed.comparisons[0].status,'closed');assert.equal(closed.comparisons[0].counts.total,1);
 assert.throws(()=>compare.public(pending.comparisonInvite.token),e=>e.code==='EXPIRED');
 assert.throws(()=>compare.close('owner',closed.state.id,cmd(closed.state,{comparisonId:r.comparisons[0].id})),e=>e.code==='CLOSED');
 assert.ok(closed.audit.consistent);
});
test('owner editorial reopening invalidates the old blind test and pending invites',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);r=invite(svc,compare,r);
 const raw=r.comparisonInvite.token;
 const reopened=svc.reopen('owner',r.state.id,cmd(r.state));
 assert.equal(reopened.state.phase,'reopened');assert.equal(reopened.comparisons[0].status,'invalidated');
 assert.throws(()=>compare.public(raw),e=>e.code==='EXPIRED');
 assert.equal(reopened.events.at(-1).type,'comparison_invalidated');
 assert.ok(reopened.audit.consistent);
});
test('witness objection invalidates open comparison without deleting prior votes',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);
 r=invite(svc,compare,r);compare.vote('friend',r.comparisonInvite.token,{choice:'first',accepted:true});
 r=svc.detail('owner',r.state.id);const toReject=invite(svc,compare,r);
 const inviteWitness=svc.invite('owner',r.state.id,cmd(toReject.state,{consent:true}));
 svc.object('second-friend',inviteWitness.invite.token,{text:'Мне непонятно, для кого действительно написано это обещание.'});
 assert.equal(compare.summaries('owner',r.state.id)[0].status,'invalidated');
 assert.equal(compare.summaries('owner',r.state.id)[0].counts.total,1);
 assert.throws(()=>compare.public(toReject.comparisonInvite.token),e=>e.code==='EXPIRED');
 assert.ok(svc.audit('owner',r.state.id).consistent);
});
test('14-day expiry stops voting, while internal results remain accessible to author',t=>{
 let now=Date.parse('2026-10-22T00:00:00.000Z');const {svc,compare}=fixture(t,()=>now);
 let r=start(svc,compare);r=invite(svc,compare,r);
 now+=8*86400000;
 assert.throws(()=>compare.public(r.comparisonInvite.token),e=>e.code==='EXPIRED');
 assert.equal(compare.summaries('owner',r.state.id)[0].invites.active,0);
 now+=7*86400000;
 assert.equal(compare.summaries('owner',r.state.id)[0].status,'expired');
});
test('author export includes poll choices but no token hashes; deletion cascades votes',t=>{
 const {svc,compare,store}=fixture(t);let r=start(svc,compare);r=invite(svc,compare,r);
 compare.vote('reader',r.comparisonInvite.token,{choice:'second',note:'Второй вариант понятнее.',accepted:true});
 const raw=JSON.stringify(svc.export('owner'));
 assert.ok(raw.includes('Второй вариант понятнее.'));
 assert.ok(!raw.includes(r.comparisonInvite.token));
 assert.ok(!raw.includes('token_hash'));
 svc.deleteCase('owner',r.state.id);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM comparisons').n,0);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM comparison_links').n,0);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM comparison_votes').n,0);
});
test('comparison cannot be created with identical original and final text',t=>{
 const {svc,compare}=fixture(t);
 let r=svc.create('owner',{claim:DEMOS[0].claim,draft:DEMOS[0]});
 r=svc.act('owner',r.state.id,cmd(r.state,{action:'narrow'}));
 r=svc.prepare('owner',r.state.id,cmd(r.state,{draft:DEMOS[0]}));
 r=svc.verdict('owner',r.state.id,cmd(r.state,{claim:DEMOS[0].claim,acknowledged:true}));
 assert.throws(()=>compare.start('owner',r.state.id,cmd(r.state,{consent:true})),e=>e.code==='SAME_VARIANTS');
});
test('at most 30 one-use voting links per study',t=>{
 const {svc,compare}=fixture(t);let r=start(svc,compare);
 for(let i=0;i<30;i++)r=invite(svc,compare,r);
 assert.equal(r.comparisons[0].invites.total,30);
 assert.throws(()=>invite(svc,compare,r),e=>e.code==='LIMIT');
});
async function launch(t){const store=new Store(':memory:'),app=createApp({store,port:3000,origin:'http://localhost:3000'});await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>{app.server.close(()=>{store.close();ok();});app.server.closeAllConnections();}));return {app,url:`http://127.0.0.1:${app.server.address().port}`};}
async function httpReq(base,path,{method='GET',body=null,cookie='',csrf='',origin='http://localhost:3000'}={}){
 return new Promise((ok,reject)=>{const payload=body===null?null:JSON.stringify(body);
  const req=http.request(base+path,{method,headers:{Host:'localhost:3000',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:origin}:{})}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{ok({code:res.statusCode,value:JSON.parse(Buffer.concat(chunks).toString()),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});});req.on('error',reject);if(payload)req.write(payload);req.end();
 });
}
test('real HTTP routes require CSRF, expose no results publicly, and persist one vote',async t=>{
 const {app,url}=await launch(t);const boot=await httpReq(url,'/api/bootstrap');const author=boot.cookie;
 let r=verdict(app.svc,app.store.one('SELECT owner_id FROM sessions').owner_id),c=r.state.id;
 const csrf=boot.value.csrf;
 const started=await httpReq(url,`/api/cases/${c}/comparison-start`,{method:'POST',body:cmd(r.state,{consent:true}),cookie:author,csrf});assert.equal(started.code,200);
 r=started.value;
 const invited=await httpReq(url,`/api/cases/${c}/comparison-invite`,{method:'POST',body:cmd(r.state,{comparisonId:r.comparisonId}),cookie:author,csrf});assert.equal(invited.code,200);
 const raw=invited.value.comparisonInvite.token;
 assert.equal((await httpReq(url,`/api/compare/${raw}`)).code,401,'public routes still require anonymous cookie bootstrap');
 const visitor=await httpReq(url,'/api/bootstrap');
 const presented=await httpReq(url,`/api/compare/${raw}`,{cookie:visitor.cookie});assert.equal(presented.code,200);
 assert.ok(presented.value.question);assert.ok(!JSON.stringify(presented.value).includes('counts'));
 const bad=await httpReq(url,`/api/compare/${raw}`,{method:'POST',body:{choice:'first',accepted:true},cookie:visitor.cookie,csrf:'wrong'});assert.equal(bad.code,403);
 const voted=await httpReq(url,`/api/compare/${raw}`,{method:'POST',body:{choice:'second',note:'Это яснее для меня.',accepted:true},cookie:visitor.cookie,csrf:visitor.value.csrf});assert.equal(voted.code,200);
 const second=await httpReq(url,`/api/compare/${raw}`,{method:'POST',body:{choice:'second',accepted:true},cookie:visitor.cookie,csrf:visitor.value.csrf});assert.equal(second.code,410);
 const ownerResults=await httpReq(url,`/api/cases/${c}/comparisons`,{cookie:author});assert.equal(ownerResults.code,200);assert.equal(ownerResults.value.comparisons[0].counts.total,1);
 const denied=await httpReq(url,`/api/cases/${c}/comparisons`,{cookie:visitor.cookie});assert.equal(denied.code,404);
});

test('blinded votes survive database reopen; public tokens remain hashed and counts remain correct',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-compare-persistence-'));
 let store;
 try{
  const file=join(dir,'persist.sqlite');store=new Store(file);
  let svc=new JudgeService(store),compare=new ComparisonService(svc);svc.comparison=compare;
  let r=start(svc,compare);r=invite(svc,compare,r);const secret=r.comparisonInvite.token,caseId=r.state.id;
  compare.vote('independent-reader',secret,{choice:'second',note:'Стало понятнее, что делать дальше.',accepted:true});
  const before=compare.summaries('owner',caseId)[0];
  assert.equal(before.counts.total,1);
  store.close();store=null;
  store=new Store(file);svc=new JudgeService(store);compare=new ComparisonService(svc);svc.comparison=compare;
  const after=compare.summaries('owner',caseId)[0];
  assert.deepEqual(after.counts,before.counts);
  assert.equal(after.notes[0].note,'Стало понятнее, что делать дальше.');
  assert.equal(svc.audit('owner',caseId).consistent,true);
  assert.throws(()=>compare.public(secret),e=>e.code==='USED');
  assert.equal(store.one('PRAGMA user_version').user_version,28);
  assert.equal(store.all('SELECT COUNT(*) AS n FROM comparison_links')[0].n,1);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('tampered case ledger rejects a vote and rolls back link usage',t=>{
 const {svc,compare,store}=fixture(t);let r=start(svc,compare);r=invite(svc,compare,r);
 const token=r.comparisonInvite.token;
 store.run('UPDATE cases SET state=? WHERE id=?',JSON.stringify({...r.state,claim:'CORRUPTED'}),r.state.id);
 assert.throws(()=>compare.vote('reader',token,{choice:'first',accepted:true}),e=>e.code==='INTEGRITY');
 assert.equal(store.one('SELECT COUNT(*) AS n FROM comparison_votes').n,0);
 assert.equal(store.one('SELECT used_at FROM comparison_links').used_at,null);
});
