import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import http from 'node:http';import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';import {DEMOS} from '../shared/domain.mjs';
async function fixture(t){
 const store=new Store(':memory:'),app=createApp({store,port:3000,origin:'http://localhost:3000',platforms:[],env:{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{app.server.close(()=>{store.close();r();});app.server.closeAllConnections();}));
 const root='http://127.0.0.1:'+app.server.address().port;
 async function request(path,{method='GET',headers={},body}={}){
  return await new Promise((resolve,reject)=>{
   const req=http.request(root+path,{method,headers:{Host:'localhost:3000',...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})}},resp=>{
    const bufs=[];resp.on('data',buf=>bufs.push(buf));resp.on('end',()=>{
     let data;try{data=JSON.parse(Buffer.concat(bufs).toString());}catch{data={};}
     resolve({status:resp.statusCode,body:data,setCookie:resp.headers['set-cookie']?.[0]||null});
    });
   });req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
  });
 }
 async function actor(id){const b=await request('/api/bootstrap');const cookie=b.setCookie.split(';')[0],csrf=b.body.csrf;
  const uid=store.one('SELECT owner_id AS id FROM sessions WHERE csrf=?',csrf).id;
  store.run('INSERT INTO users VALUES(?,?,?,?)',uid,`${id}@qa.invalid`,'fake','2026-10-22T00:00:00Z');
  const headers={Cookie:cookie,'X-CSRF-Token':csrf,Origin:'http://localhost:3000'};
  return {id:uid,get:p=>request('/api'+p,{headers}),post:(p,body,extra={})=>request('/api'+p,{method:'POST',headers:{...headers,...extra},body})};
 }
 const owner=await actor('owner'),editor=await actor('editor'),outsider=await actor('outsider');
 const wid=app.workspaces.create(owner.id,{name:'Development Agency'}).id;
 app.workspaces.accept(editor.id,app.workspaces.issueInvite(owner.id,wid,{role:'reviewer'}).token);
 let r=app.svc.create(owner.id,{claim:DEMOS[0].claim,draft:DEMOS[0]});const caseId=r.state.id;
 const cmd=x=>({commandId:randomUUID(),expectedVersion:r.state.version,...x});
 r=app.svc.act(owner.id,caseId,cmd({action:'narrow'}));r=app.svc.prepare(owner.id,caseId,cmd({draft:DEMOS[0]}));r=app.svc.verdict(owner.id,caseId,cmd({claim:'A clearer advertising product brief',acknowledged:true}));
 app.workspaces.share(owner.id,wid,caseId);
 let c=app.production.create(owner.id,{workspaceId:wid,name:'October launch',objective:'Promote clear advertising claims in JUDGE',audience:'Small teams',channel:'social'});const cid=c.campaign.id;
 c=app.production.attach(owner.id,cid,{caseId,expectedRevision:c.campaign.revision});const bid=c.briefs[0].id;
 c=app.production.addEvidence(owner.id,cid,{expectedRevision:c.campaign.revision,briefId:bid,statement:'JUDGE improves clarity of copy',kind:'document',locator:'Reference 2026',explanation:'Review text against documented functionality'});
 const eid=c.evidence[0].id;c=app.production.reviewEvidence(editor.id,cid,eid,{inspected:true,expectedRevision:c.campaign.revision});
 c=app.production.creative(owner.id,cid,{expectedRevision:c.campaign.revision,briefId:bid,channel:'social',language:'en',headline:'Make ads clear',body:'Turn facts into actionable briefs',cta:'Get started'});
 return {app,root,owner,editor,outsider,cid,wid,eid,creativeId:c.creatives[0].id};
}
test('HTTP 16-20: CSRF, roles, owner strict policy and real preflight gates',async t=>{
 const f=await fixture(t),cid=f.cid,{owner,editor,outsider}=f;
 assert.equal((await outsider.get('/governance/campaigns/'+cid)).status,404);
 let got=await owner.get('/governance/campaigns/'+cid);assert.equal(got.status,200);const rev=got.body.revision;
 assert.equal((await editor.post('/governance/campaigns/'+cid+'/policy',{requireMapping:true,expectedRevision:rev})).status,403);
 assert.equal((await owner.post('/governance/campaigns/'+cid+'/policy',{requireMapping:true,expectedRevision:rev},{'X-CSRF-Token':'bad'})).status,403);
 got=await owner.post('/governance/campaigns/'+cid+'/policy',{requireMapping:true,expectedRevision:rev});assert.equal(got.status,200);
 assert.ok(got.body.gates.some(x=>x.startsWith('UNTRACED_CREATIVE')));
 const stale=await owner.post('/governance/campaigns/'+cid+'/link',{creativeId:f.creativeId,evidenceId:f.eid,expectedRevision:rev});assert.equal(stale.status,409);
 got=await owner.post('/governance/campaigns/'+cid+'/link',{creativeId:f.creativeId,evidenceId:f.eid,expectedRevision:got.body.revision});assert.equal(got.status,200);
 assert.equal(got.body.gates.length,0);
 got=await owner.post('/governance/campaigns/'+cid+'/issue',{severity:'critical',title:'Unsupported wording',details:'Source wording needs clarification before public release.',expectedRevision:got.body.revision});
 assert.equal(got.status,201);const iid=got.body.issues[0].id;
 assert.equal((await owner.post('/governance/campaigns/'+cid+'/issue-resolve',{issueId:iid,note:'I edited it myself so it is acceptable',expectedRevision:got.body.revision})).status,403);
 got=await editor.post('/governance/campaigns/'+cid+'/issue-resolve',{issueId:iid,note:'Independent check confirmed that the wording no longer overstates the fact.',expectedRevision:got.body.revision});
 assert.equal(got.status,200);assert.equal(got.body.gates.length,0);
 const bundle=await owner.get('/governance/campaigns/'+cid+'/audit-bundle');assert.equal(bundle.status,200);assert.match(bundle.body.sha256,/^[0-9a-f]{64}$/);
 assert.equal((await outsider.get('/governance/campaigns/'+cid+'/audit-bundle')).status,404);
});
test('HTTP 19-20: emergency pause owner only, portfolio visible to member, privacy export',async t=>{
 const f=await fixture(t),{owner,editor,outsider,wid,cid}=f;
 assert.equal((await outsider.get('/governance/workspaces/'+wid+'/portfolio')).status,404);
 assert.equal((await editor.get('/governance/workspaces/'+wid+'/portfolio')).status,200);
 assert.equal((await editor.post('/governance/workspaces/'+wid+'/control',{dispatchPaused:true,reason:'Security incident under review'})).status,403);
 let paused=await owner.post('/governance/workspaces/'+wid+'/control',{dispatchPaused:true,reason:'Security incident under review'});
 assert.equal(paused.status,200);assert.equal(paused.body.dispatchPaused,true);
 assert.equal((await editor.get('/governance/campaigns/'+cid)).body.control.dispatchPaused,true);
 paused=await owner.post('/governance/workspaces/'+wid+'/control',{dispatchPaused:false,reason:'Security controls independently checked'});
 assert.equal(paused.status,200);assert.equal(paused.body.dispatchPaused,false);
 const exported=await owner.get('/privacy/export');assert.equal(exported.status,200);assert.ok(exported.body.governance);
});
