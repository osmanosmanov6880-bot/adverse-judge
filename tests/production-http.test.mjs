import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {DEMOS} from '../shared/domain.mjs';
function httpRequest(root,path,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request(root+path,{method,headers:{Host:'localhost:3000',...headers}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{
    const raw=Buffer.concat(chunks).toString();
    let value;try{value=JSON.parse(raw);}catch{value=raw;}
    resolve({status:res.statusCode,headers:res.headers,body:value});
   });
  });req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
 });
}
async function fixture(t){
 const store=new Store(':memory:'),app=createApp({store,port:3000,origin:'http://localhost:3000',env:{}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{app.server.close(()=>{store.close();resolve();});app.server.closeAllConnections();}));
 const root=`http://127.0.0.1:${app.server.address().port}`;
 async function user(label){
  const x=await httpRequest(root,'/api/bootstrap');const cookie=x.headers['set-cookie'][0].split(';')[0],csrf=x.body.csrf;
  const sid=store.one('SELECT owner_id FROM sessions WHERE csrf=?',csrf).owner_id;
  store.run('INSERT INTO users VALUES(?,?,?,?)',sid,label+'@qa.invalid','no-password-login','2026-10-22T00:00:00Z');
  const headers={Cookie:cookie,'X-CSRF-Token':csrf,Origin:'http://localhost:3000','Content-Type':'application/json'};
  return {id:sid,headers,get:(path)=>httpRequest(root,path,{headers}),post:(path,body,override={})=>httpRequest(root,path,{method:'POST',headers:{...headers,...override},body})};
 }
 const owner=await user('owner'),reviewer=await user('reviewer'),outsider=await user('outsider');
 const workspaceId=app.workspaces.create(owner.id,{name:'Agency Production Lab'}).id;
 app.workspaces.accept(reviewer.id,app.workspaces.issueInvite(owner.id,workspaceId,{role:'reviewer'}).token);
 const d=DEMOS[0];let c=app.svc.create(owner.id,{claim:d.claim,draft:d});const caseId=c.state.id;
 const cmd=payload=>({expectedVersion:c.state.version,commandId:randomUUID(),...payload});
 c=app.svc.act(owner.id,caseId,cmd({action:'narrow'}));c=app.svc.prepare(owner.id,caseId,cmd({draft:d}));
 c=app.svc.verdict(owner.id,caseId,cmd({claim:'Create an ad from a concrete product fact',acknowledged:true}));
 app.workspaces.share(owner.id,workspaceId,caseId);
 return {root,app,store,owner,reviewer,outsider,workspaceId,caseId};
}
test('production HTTP flow: source, evidence, approval, release and author-only revision',async t=>{
 const f=await fixture(t),{owner,reviewer,outsider,workspaceId,caseId}=f;
 let x=await owner.post('/api/production/campaigns',{workspaceId,name:'Agency strategy campaign',objective:'Help creative agency owners review claims',audience:'Local creative agencies',channel:'social'});
 assert.equal(x.status,201);const id=x.body.campaign.id;let rev=x.body.campaign.revision;
 assert.equal((await outsider.get('/api/production/campaigns/'+id)).status,404);
 assert.equal((await outsider.get('/api/production/campaigns?workspaceId='+workspaceId)).status,404);
 assert.equal((await outsider.post('/api/production/campaigns/'+id+'/attach',{caseId,expectedRevision:rev})).status,404);
 x=await owner.post('/api/production/campaigns/'+id+'/attach',{caseId,expectedRevision:rev});assert.equal(x.status,200);rev=x.body.campaign.revision;
 const briefId=x.body.briefs[0].id;
 x=await owner.post('/api/production/campaigns/'+id+'/evidence',{expectedRevision:rev,briefId,kind:'document',statement:'Advertising material can be created',locator:'Documentation page 3',explanation:'Compare this exact claim with the implementation.'});assert.equal(x.status,201);rev=x.body.campaign.revision;
 const evidenceId=x.body.evidence[0].id;
 assert.equal((await owner.post('/api/production/campaigns/'+id+'/evidence/'+evidenceId,{expectedRevision:rev,inspected:true})).status,403);
 x=await reviewer.post('/api/production/campaigns/'+id+'/evidence/'+evidenceId,{expectedRevision:rev,inspected:true});assert.equal(x.status,200);rev=x.body.campaign.revision;
 x=await owner.post('/api/production/campaigns/'+id+'/creatives',{expectedRevision:rev,briefId,channel:'social',language:'en',headline:'Ads that communicate clearly',body:'Build an advertising brief with factual statements.',cta:'Review your claim'});assert.equal(x.status,201);rev=x.body.campaign.revision;
 assert.equal((await owner.post('/api/production/campaigns/'+id+'/review-decision',{expectedRevision:rev,decision:'approve',note:'No actual review submitted yet'})).status,409);
 x=await owner.post('/api/production/campaigns/'+id+'/review-request',{expectedRevision:rev,note:'Please examine the sources and creative copy.'});assert.equal(x.status,200);
 assert.equal((await owner.post('/api/production/campaigns/'+id+'/review-decision',{expectedRevision:rev,decision:'approve',note:'Trying to self approve'})).status,403);
 x=await reviewer.post('/api/production/campaigns/'+id+'/review-decision',{expectedRevision:rev,decision:'approve',note:'I inspected the evidence and editorial wording.'});assert.equal(x.status,200);assert.equal(x.body.campaign.status,'approved');
 x=await owner.post('/api/production/campaigns/'+id+'/release',{expectedRevision:rev});assert.equal(x.status,200);const rel=x.body.releaseId;
 const out=await owner.get('/api/production/campaigns/'+id+'/export/'+rel);assert.equal(out.status,200);assert.equal(out.body.deliveryConfirmed,false);assert.equal(out.body.creatives.length,1);
 const {sha256,id:rid,deliveryConfirmed,...payload}=out.body;
 assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),sha256);
 assert.equal((await outsider.get('/api/production/campaigns/'+id+'/export/'+rel)).status,404);
 assert.equal((await owner.post('/api/production/campaigns/'+id+'/release',{expectedRevision:rev})).body.duplicate,true);
});
test('production HTTP demands CSRF, preserves ownership, and blocks stale versions',async t=>{
 const f=await fixture(t),{owner,workspaceId}=f;
 const campaign=(await owner.post('/api/production/campaigns',{workspaceId,name:'First marketing wave',objective:'Analyze real user questions',audience:'Small product firms',channel:'email'})).body.campaign;
 let result=await owner.post('/api/production/campaigns/'+campaign.id+'/update',{expectedRevision:1,name:'Modified wave',objective:'Analyze real user questions',audience:'Small product firms',channel:'email'}, {'X-CSRF-Token':''});
 assert.equal(result.status,403);assert.equal(result.body.error.code,'CSRF');
 result=await owner.post('/api/production/campaigns/'+campaign.id+'/update',{expectedRevision:1,name:'Modified wave',objective:'Analyze real user questions',audience:'Small product firms',channel:'email'}, {Origin:'https://external.invalid'});
 assert.equal(result.status,403);assert.equal(result.body.error.code,'ORIGIN');
 result=await owner.post('/api/production/campaigns/'+campaign.id+'/update',{expectedRevision:1,name:'Modified wave',objective:'Analyze real user questions',audience:'Small product firms',channel:'email'});
 assert.equal(result.status,200);assert.equal(result.body.campaign.revision,2);
 result=await owner.post('/api/production/campaigns/'+campaign.id+'/update',{expectedRevision:1,name:'Replayed change',objective:'Analyze real user questions',audience:'Small product firms',channel:'email'});
 assert.equal(result.status,409);assert.equal(result.body.error.code,'VERSION_CONFLICT');
});
