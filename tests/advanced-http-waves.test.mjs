import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {DEMOS} from '../shared/domain.mjs';
function httpJSON(root,path,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{const req=http.request(root+path,{method,headers:{Host:'localhost:3000',...headers}},res=>{
 const arr=[];res.on('data',p=>arr.push(p));res.on('end',()=>{
 let result;try{result=JSON.parse(Buffer.concat(arr).toString())}catch{result=Buffer.concat(arr).toString();}
 resolve({status:res.statusCode,body:result,headers:res.headers});});});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});
}
async function setup(t,{partner=false}={}){
 const prev=process.env.JUDGE_WAVES_PARTNER_KEY;
 if(partner){process.env.JUDGE_WAVES_PARTNER_KEY='qa-partner-server-secret-2026-1234567890';t.after(()=>{if(prev===undefined)delete process.env.JUDGE_WAVES_PARTNER_KEY;else process.env.JUDGE_WAVES_PARTNER_KEY=prev;});}
 const platforms=partner?[{id:'A',name:'Verified fake partner',mode:'deeplink',verified:true,url:'https://adversarial-test.example.org/ingest',credentialEnv:'JUDGE_WAVES_PARTNER_KEY',confirmedEvents:['asset_created']}]:[];
 const store=new Store(':memory:'),app=createApp({store,port:3000,origin:'http://localhost:3000',env:{},platforms,secret:partner?'server-signature-key-2026-12345678901234567890':''});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{app.server.close(()=>{store.close();r();});app.server.closeAllConnections();}));
 const root='http://127.0.0.1:'+app.server.address().port;
 async function createUser(name){const start=await httpJSON(root,'/api/bootstrap');const cookie=start.headers['set-cookie'][0].split(';')[0];const csrf=start.body.csrf;
 const owner=store.one('SELECT owner_id FROM sessions WHERE csrf=?',csrf).owner_id;
 store.run('INSERT INTO users VALUES(?,?,?,?)',owner,name+'@qa.invalid','non-loginable','2026-10-22T00:00:00Z');
 const headers={Cookie:cookie,'X-CSRF-Token':csrf,Origin:'http://localhost:3000','Content-Type':'application/json'};
 return {id:owner,headers,get:p=>httpJSON(root,p,{headers}),post:(p,body,override={})=>httpJSON(root,p,{method:'POST',headers:{...headers,...override},body})};}
 const alice=await createUser('alice'),bob=await createUser('bob'),eve=await createUser('eve');
 const wid=app.workspaces.create(alice.id,{name:'Ads Team'}).id;
 app.workspaces.accept(bob.id,app.workspaces.issueInvite(alice.id,wid,{role:'reviewer'}).token);
 const d=DEMOS[0];let cs=app.svc.create(alice.id,{claim:d.claim,draft:d});const caseId=cs.state.id;
 const cmd=p=>({commandId:randomUUID(),expectedVersion:cs.state.version,...p});
 cs=app.svc.act(alice.id,caseId,cmd({action:'narrow'}));cs=app.svc.prepare(alice.id,caseId,cmd({draft:d}));cs=app.svc.verdict(alice.id,caseId,cmd({claim:'Create an ad using clear product facts',acknowledged:true}));
 app.workspaces.share(alice.id,wid,caseId);
 const cc=app.production.create(alice.id,{workspaceId:wid,name:'October launch',objective:'Tell customers about safer copy reviews',audience:'Independent creative studios',channel:'social'});
 return {app,store,root,alice,bob,eve,wid,cid:cc.campaign.id,caseId};
}
test('wave 11-13 HTTP: brand, targets, quality, authorization and CSRF',async t=>{
 const f=await setup(t),{alice,bob,eve,cid,wid}=f;
 assert.equal((await eve.get('/api/ops/campaigns/'+cid)).status,404);
 assert.equal((await eve.get('/api/ops/workspaces/'+wid+'/brands')).status,404);
 assert.equal((await alice.post('/api/ops/workspaces/'+wid+'/brands',{name:'Clear Brand',voice:'Only prove what the product does'}, {'X-CSRF-Token':'wrong'})).status,403);
 let res=await alice.post('/api/ops/workspaces/'+wid+'/brands',{name:'Clear Brand',voice:'Only prove what the product does',requiredTerms:['clear']});
 assert.equal(res.status,201);const bid=res.body.id;
 res=await bob.post('/api/ops/workspaces/'+wid+'/brands',{name:'Wrong role',voice:'Cannot rewrite brand requirements'});assert.equal(res.status,403);
 let c=await alice.get('/api/ops/campaigns/'+cid);assert.equal(c.status,200);
 res=await alice.post('/api/ops/campaigns/'+cid+'/brand',{brandId:bid,expectedRevision:c.body.revision});assert.equal(res.status,200);
 res=await alice.post('/api/ops/campaigns/'+cid+'/targets',{targets:[{channel:'social',language:'zh'}],expectedRevision:res.body.revision});assert.equal(res.status,200);
 assert.equal((await alice.post('/api/ops/campaigns/'+cid+'/audit',{})).status,200);
 const gate=(await bob.get('/api/ops/campaigns/'+cid)).body.qaGate;
 assert.ok(gate.some(x=>x.startsWith('MISSING_TARGET')));
 assert.equal((await eve.post('/api/ops/campaigns/'+cid+'/audit',{})).status,404);
});
test('wave 14-15 HTTP: unconfigured partner refuses dispatch and data creation requires release',async t=>{
 const f=await setup(t),{alice,cid,eve}=f;
 const x=await alice.post('/api/ops/campaigns/'+cid+'/dispatch',{platformId:'A',releaseId:randomUUID(),consent:true});
 assert.equal(x.status,404);
 assert.equal((await alice.post('/api/ops/campaigns/'+cid+'/observation',{releaseId:randomUUID(),date:'2026-10-21',impressions:10,clicks:2,leads:1,spendMinor:100,currency:'EUR',note:'This is sample data only'})).status,404);
 assert.equal((await eve.get('/api/ops/campaigns/'+cid)).status,404);
 assert.equal((await httpJSON(f.root,'/api/integrations/release-redeem',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer malicious'},body:{platformId:'A',token:'x',requestId:'idemp-123456'}})).status,401);
 const response=await alice.get('/api/privacy/export');assert.equal(response.status,200);assert.ok(response.body.advanced);
});

test('wave 14 server-to-server HTTP: signed release, partner acknowledgement, replay protection',async t=>{
 const f=await setup(t,{partner:true}),{alice,bob,cid,caseId}=f;
 let c=(await alice.get('/api/production/campaigns/'+cid)).body.campaign;
 let x=await alice.post('/api/production/campaigns/'+cid+'/attach',{caseId,expectedRevision:c.revision});assert.equal(x.status,200);
 const brief=x.body.briefs[0].id;c=x.body.campaign;
 x=await alice.post('/api/production/campaigns/'+cid+'/evidence',{briefId:brief,statement:'JUDGE can improve clarity of ad briefs',kind:'document',locator:'Historic manual v1',explanation:'Human checks this claim against the user manual',expectedRevision:c.revision});
 c=x.body.campaign;
 x=await bob.post('/api/production/campaigns/'+cid+'/evidence/'+x.body.evidence[0].id,{inspected:true,expectedRevision:c.revision});c=x.body.campaign;
 x=await alice.post('/api/production/campaigns/'+cid+'/creatives',{expectedRevision:c.revision,briefId:brief,channel:'social',language:'en',headline:'Create a clear marketing brief',body:'A clear brief for your product message',cta:'Start creating'});c=x.body.campaign;
 x=await alice.post('/api/production/campaigns/'+cid+'/review-request',{expectedRevision:c.revision,note:'Please review this campaign independently.'});assert.equal(x.status,200);
 x=await bob.post('/api/production/campaigns/'+cid+'/review-decision',{expectedRevision:c.revision,decision:'approve',note:'Independent human review performed carefully.'});assert.equal(x.status,200);
 x=await alice.post('/api/production/campaigns/'+cid+'/release',{expectedRevision:c.revision});assert.equal(x.status,200);
 const rel=x.body.releaseId;
 x=await alice.post('/api/ops/campaigns/'+cid+'/dispatch',{releaseId:rel,platformId:'A',consent:true});assert.equal(x.status,201);
 const {dispatchId,token}=x.body;
 const bad=await httpJSON(f.root,'/api/integrations/release-redeem',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer not-allowed'},body:{platformId:'A',token,requestId:'idempotency-001'}});
 assert.equal(bad.status,401);
 const call=async (path,body)=>httpJSON(f.root,path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer qa-partner-server-secret-2026-1234567890'},body});
 x=await call('/api/integrations/release-redeem',{platformId:'A',token,requestId:'idempotency-001'});assert.equal(x.status,200);assert.equal(x.body.payload.creatives.length,1);
 assert.equal((await call('/api/integrations/release-redeem',{platformId:'A',token,requestId:'another-0002'})).status,409);
 x=await call('/api/integrations/release-events',{platformId:'A',dispatchId,eventId:'partner-event-001',action:'asset_created'});assert.equal(x.status,200);assert.equal(x.body.duplicate,false);
 x=await call('/api/integrations/release-events',{platformId:'A',dispatchId,eventId:'partner-event-001',action:'asset_created'});assert.equal(x.status,200);assert.equal(x.body.duplicate,true);
 assert.equal((await alice.get('/api/ops/campaigns/'+cid)).body.dispatches[0].status,'confirmed');
});
