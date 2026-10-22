import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {createPushReceiver} from '../integrations/push-receiver.mjs';
import {DEMOS} from '../shared/domain.mjs';
const RECEIVER_KEY='wave24-integration-test-secret-receiver-2026';
const CRED='wave24-test-confirmation-callback-key-2026';
const SECRET='wave24-signing-secret-server-2026-abcdefghijk';
function transport(root,path,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{const req=http.request(root+path,{method,headers:{...headers,'Host':headers.Host??'localhost:3000',...(body!==undefined?{'Content-Type':'application/json'}:{})}},res=>{
 const arr=[];res.on('data',x=>arr.push(x));res.on('end',()=>{const raw=Buffer.concat(arr).toString();let data;try{data=JSON.parse(raw);}catch{data=raw;}resolve({status:res.statusCode,body:data,headers:res.headers});});});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});
}
async function setup(t,{partner=false,mailer=null}={}){
 const env={JUDGE_WAVE24_KEY:RECEIVER_KEY,JUDGE_WAVE24_CALLBACK:CRED};
 const platforms=partner?[{id:'A',name:'Local HTTP reference receiver',mode:'api',verified:true,deliveryUrl:'https://example-adversarial-partner.invalid/push',deliveryKeyEnv:'JUDGE_WAVE24_KEY',credentialEnv:'JUDGE_WAVE24_CALLBACK',confirmedEvents:['asset_created']}]:[];
 const store=new Store(':memory:');
 const partnerReceipts=[];
 const receiver=http.createServer(createPushReceiver({secret:RECEIVER_KEY,onAccepted:async x=>partnerReceipts.push(x)}));
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 const port=receiver.address().port;
 const injectedFetch=(url,options)=>{
  assert.equal(url,'https://example-adversarial-partner.invalid/push');
  return fetch(`http://127.0.0.1:${port}/push`,options);
 };
 const outbox=createApp({store,port:3000,origin:'http://localhost:3000',platforms,secret:partner?SECRET:'',env,mailer,deliveryFetch:injectedFetch});
 await new Promise(r=>outbox.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>outbox.server.close(r));outbox.server.closeAllConnections();await new Promise(r=>receiver.close(r));receiver.closeAllConnections();store.close();});
 const root=`http://127.0.0.1:${outbox.server.address().port}`;
 async function actor(name){
  const start=await transport(root,'/api/bootstrap');const cookie=start.headers['set-cookie'][0].split(';')[0],csrf=start.body.csrf;
  const user=store.one('SELECT owner_id AS id FROM sessions WHERE csrf=?',csrf).id;
  store.run('INSERT INTO users VALUES(?,?,?,?)',user,`${name}@qa.invalid`,'non-loginable','2026-10-22T01:00:00Z');
  const headers={Cookie:cookie,'X-CSRF-Token':csrf,Origin:'http://localhost:3000'};
  return {id:user,get:p=>transport(root,'/api'+p,{headers}),post:(p,body,extra={})=>transport(root,'/api'+p,{method:'POST',headers:{...headers,...extra},body})};
 }
 const owner=await actor('owner'),editor=await actor('editor'),outsider=await actor('outsider');
 const wid=outbox.workspaces.create(owner.id,{name:'Waves 21-25 QA workspace'}).id;
 outbox.workspaces.accept(editor.id,outbox.workspaces.issueInvite(owner.id,wid,{role:'reviewer'}).token);
 const d=DEMOS[0];let c=outbox.svc.create(owner.id,{claim:d.claim,draft:d});const caseId=c.state.id;
 const cmd=x=>({commandId:randomUUID(),expectedVersion:c.state.version,...x});
 c=outbox.svc.act(owner.id,caseId,cmd({action:'narrow'}));c=outbox.svc.prepare(owner.id,caseId,cmd({draft:d}));c=outbox.svc.verdict(owner.id,caseId,cmd({claim:'Provide a clear advertising brief from user product facts',acknowledged:true}));
 outbox.workspaces.share(owner.id,wid,caseId);
 let p=outbox.production.create(owner.id,{workspaceId:wid,name:'October brand launch plan',objective:'Demonstrate a marketing brief review process',audience:'Small teams of marketers',channel:'social'});const cid=p.campaign.id;
 p=outbox.production.attach(owner.id,cid,{caseId,expectedRevision:p.campaign.revision});const briefId=p.briefs[0].id;
 p=outbox.production.addEvidence(owner.id,cid,{expectedRevision:p.campaign.revision,briefId,statement:'Tool prepares an advertising brief',kind:'document',locator:'Documentation v1',explanation:'Independently inspected feature'});
 p=outbox.production.reviewEvidence(editor.id,cid,p.evidence[0].id,{inspected:true,expectedRevision:p.campaign.revision});
 p=outbox.production.creative(owner.id,cid,{expectedRevision:p.campaign.revision,briefId,channel:'social',language:'en',headline:'A clear advertising brief',body:'Start from product facts to review marketing copy',cta:'Start now'});
 p=outbox.production.requestReview(owner.id,cid,{expectedRevision:p.campaign.revision,note:'Please review editorial wording and evidence'});
 p=outbox.production.decide(editor.id,cid,{expectedRevision:p.campaign.revision,decision:'approve',note:'Independent human reviewed the claim and creative'});
 const release=outbox.production.release(owner.id,cid,{expectedRevision:p.campaign.revision});
 return {root,store,app:outbox,owner,editor,outsider,cid,wid,release,partnerReceipts};
}
test('WAVE 21 HTTP — verify once, reset sessions, reject CSRF and preserve privacy',async t=>{
 let mail=[];const f=await setup(t,{mailer:async x=>mail.push(x)});
 assert.equal((await f.outsider.get('/auth/identity')).body.verified,false);
 assert.equal((await f.owner.post('/auth/verify/request',{}, {'X-CSRF-Token':'bad'})).status,403);
 const sent=await f.owner.post('/auth/verify/request',{});
 assert.equal(sent.status,200);assert.equal(sent.body.code,undefined);assert.equal(mail.length,1);
 const code=mail[0].code;
 assert.equal((await f.outsider.post('/auth/verify/confirm',{code})).status,410);
 assert.equal((await f.owner.post('/auth/verify/confirm',{code})).status,200);
 assert.equal((await f.owner.post('/auth/verify/confirm',{code})).status,410);
 assert.equal((await f.owner.get('/auth/identity')).body.verified,true);
 const bad=await f.owner.post('/auth/recovery/request',{email:'notregistered@qa.invalid'});
 assert.equal(bad.status,200);assert.equal(bad.body.sent,true);
 assert.equal(mail.length,1);
});
test('WAVE 22–23 HTTP — cross-tenant denial, immutable revision and CSV digest commit',async t=>{
 const f=await setup(t),releaseId=f.release.releaseId;
 assert.equal((await f.outsider.get(`/revisions/campaigns/${f.cid}/${releaseId}`)).status,404);
 assert.equal((await f.owner.get(`/revisions/campaigns/${f.cid}/${releaseId}`)).status,200);
 const input={releaseId,sourceName:'Operator CSV test',csv:'date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-22,1500,200,10,3,EUR,Manual numbers not verified'};
 assert.equal((await f.outsider.post(`/imports/campaigns/${f.cid}/preview`,input)).status,404);
 const preview=await f.owner.post(`/imports/campaigns/${f.cid}/preview`,input);
 assert.equal(preview.status,200);assert.equal(preview.body.rows.length,1);
 assert.equal((await f.owner.post(`/imports/campaigns/${f.cid}/commit`,{...input,digest:'0'.repeat(64),expectedRevision:preview.body.revision,acknowledged:true})).status,409);
 const correct=await f.owner.post(`/imports/campaigns/${f.cid}/commit`,{...input,digest:preview.body.digest,expectedRevision:preview.body.revision,acknowledged:true});
 assert.equal(correct.status,201);assert.equal(correct.body.duplicate,false);
 const duplicate=await f.owner.post(`/imports/campaigns/${f.cid}/commit`,{...input,digest:preview.body.digest,expectedRevision:preview.body.revision,acknowledged:true});
 assert.equal(duplicate.body.duplicate,true);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaign_observations').n,1);
});
test('WAVE 24 real HTTP — signed partner receiver acknowledges same package only once; no fabricated ad action',async t=>{
 const f=await setup(t,{partner:true});
 const d=await f.owner.post(`/ops/campaigns/${f.cid}/dispatch`,{releaseId:f.release.releaseId,platformId:'A',consent:true});
 assert.equal(d.status,201);
 const q=await f.owner.post(`/delivery/campaigns/${f.cid}/queue`,{dispatchId:d.body.dispatchId});
 assert.equal(q.status,201);assert.equal(q.body.status,'queued');
 assert.equal((await f.outsider.post(`/delivery/campaigns/${f.cid}/attempt/${q.body.id}`,{})).status,404);
 const r=await f.owner.post(`/delivery/campaigns/${f.cid}/attempt/${q.body.id}`,{});
 assert.equal(r.status,200);assert.equal(r.body.status,'accepted');assert.equal(r.body.confirmedAdAction,false);
 assert.equal(f.partnerReceipts.length,1);assert.equal(f.partnerReceipts[0].sha256,f.release.digest);
 const again=await f.owner.post(`/delivery/campaigns/${f.cid}/attempt/${q.body.id}`,{});
 assert.equal(again.body.duplicate,true);assert.equal(f.partnerReceipts.length,1);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM dispatch_receipts').n,0);
});
test('WAVE 24 receiver rejects forged signatures, bad body digest and conflicting idempotency key',async t=>{
 const receipts=[];const handler=createPushReceiver({secret:RECEIVER_KEY,onAccepted:async x=>receipts.push(x)});
 const srv=http.createServer(handler);await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>srv.close(r)));
 const uri=`http://127.0.0.1:${srv.address().port}`;
 const key='judge-'+randomUUID();
 const sha=x=>createHash('sha256').update(x).digest('hex');
 const packagePayload={schema:'adverse-editorial-release-1',campaign:{id:randomUUID()},briefs:[],creatives:[],evidence:[],editorialApproval:{reviewerId:'test'},createdAt:'2026-10-22T06:00:00Z'};
 const releaseId=randomUUID(),digest=sha(JSON.stringify(packagePayload));
 const envelope={schema:'adverse-release-push-1',dispatchId:randomUUID(),releaseId,sha256:digest,package:{id:releaseId,sha256:digest,...packagePayload,deliveryConfirmed:false}};
 const signed=(data,id=key)=>{const raw=JSON.stringify(data),bodyHash=sha(raw);return {Host:'localhost:3000','X-ADVERSE-Idempotency-Key':id,'X-ADVERSE-Body-SHA256':bodyHash,'X-ADVERSE-Signature':'v1='+createHmac('sha256',RECEIVER_KEY).update(id+'\n'+bodyHash).digest('hex')};};
 const forged=await transport(uri,'/',{method:'POST',headers:{...signed(envelope),'X-ADVERSE-Signature':'v1='+ '0'.repeat(64)},body:envelope});
 assert.equal(forged.status,401);assert.equal(receipts.length,0);
 const wrongDigest=await transport(uri,'/',{method:'POST',headers:{...signed(envelope),'X-ADVERSE-Body-SHA256':'0'.repeat(64)},body:envelope});
 assert.equal(wrongDigest.status,401);assert.equal(receipts.length,0);
 const accepted=await transport(uri,'/',{method:'POST',headers:signed(envelope),body:envelope});
 assert.equal(accepted.status,202);assert.equal(receipts.length,1);
 const repeated=await transport(uri,'/',{method:'POST',headers:signed(envelope),body:envelope});
 assert.equal(repeated.status,202);assert.equal(repeated.body.duplicate,true);assert.equal(receipts.length,1);
 const modified={...envelope,dispatchId:randomUUID()};
 const conflict=await transport(uri,'/',{method:'POST',headers:signed(modified),body:modified});
 assert.equal(conflict.status,409);assert.equal(receipts.length,1);
});
test('WAVE 25 HTTP — workspace diagnostics are scoped; environment-wide readiness not exposed',async t=>{
 const f=await setup(t);
 const good=await f.owner.get('/ops/workspaces/'+f.wid);
 assert.equal(good.status,200);assert.equal(good.body.productionReady,false);
 assert.equal((await f.outsider.get('/ops/workspaces/'+f.wid)).status,404);
 assert.equal((await f.owner.get('/ops/production-ready')).status,404);
 assert.ok(f.app.readiness.report().blockers.includes('durable_server_database'));
});
test('WAVES 21–25 privacy export includes new authored data without tokens or credentials',async t=>{
 const f=await setup(t),r=f.release.releaseId;
 const csv='date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-22,500,100,3,1,EUR,Human provided values';
 const src={releaseId:r,csv,sourceName:'My reports for October'};
 const preview=await f.owner.post('/imports/campaigns/'+f.cid+'/preview',src);
 await f.owner.post('/imports/campaigns/'+f.cid+'/commit',{...src,digest:preview.body.digest,expectedRevision:preview.body.revision,acknowledged:true});
 const report=await f.owner.get('/privacy/export');
 assert.equal(report.status,200);assert.equal(report.body.waves21to25.manualCsvBatches.length,1);
 assert.equal(report.body.waves21to25.manualCsvBatches[0].sourceName,src.sourceName);
 assert.equal(JSON.stringify(report.body).includes('token_hash'),false);
});
test('WAVES 21–25 privacy deletion scrubs authored batch metadata from surviving workspace',async t=>{
 const f=await setup(t),r=f.release.releaseId;
 const csv='date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-22,500,100,3,1,EUR,Human provided values';
 const src={releaseId:r,csv,sourceName:'Pseudonymous personal note'};
 const preview=await f.editor.post('/imports/campaigns/'+f.cid+'/preview',src);
 assert.equal(preview.status,200);
 const committed=await f.editor.post('/imports/campaigns/'+f.cid+'/commit',{...src,digest:preview.body.digest,expectedRevision:preview.body.revision,acknowledged:true});
 assert.equal(committed.status,201);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM measurement_batches WHERE created_by=?',f.editor.id).n,1);
 const deleted=await f.editor.post('/privacy/delete',{confirm:'DELETE'});
 assert.equal(deleted.status,200);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM measurement_batches WHERE created_by=?',f.editor.id).n,0);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaign_observations WHERE actor_id=?',f.editor.id).n,0);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaigns').n,1);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaign_releases').n,0); // independent reviewer left: old approval was invalidated
});
