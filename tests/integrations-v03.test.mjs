import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {createApp} from '../server/index.mjs';
import {DEMOS,replay} from '../shared/domain.mjs';
import {validatePlatformManifest,validReceiverURL,integrationReadiness} from '../server/platform-config.mjs';
import {diagnosePlatformFile} from '../scripts/platform-doctor.mjs';
import http from 'node:http';
const SECRET='contract-secret-unique-with-32-plus-characters';
const CRED='tested-independent-platform-secret-opaque';
const ID='JUDGE_V03_TEST_CREDENTIAL';
const config=[{id:'A',name:'Example receiver',mode:'deeplink',verified:true,url:'https://partner.example.com/judge',credentialEnv:ID,confirmedEvents:['ad_created','ad_exported']}];
function fixture(t,opts={}){
 const former=process.env[ID];process.env[ID]=CRED;
 const store=new Store(':memory:');
 t.after(()=>{store.close();if(former===undefined)delete process.env[ID];else process.env[ID]=former;});
 return {store,svc:new JudgeService(store,{secret:SECRET,platforms:config,...opts})};
}
const cmd=(s,body={})=>({commandId:randomUUID(),expectedVersion:s.version,...body});
function verdict(svc,owner='owner'){
 let r=svc.create(owner,{claim:DEMOS[0].claim,draft:DEMOS[0]});
 r=svc.act(owner,r.state.id,cmd(r.state,{action:'narrow'}));
 r=svc.prepare(owner,r.state.id,cmd(r.state,{draft:DEMOS[0]}));
 return svc.verdict(owner,r.state.id,cmd(r.state,{claim:r.state.candidates[0].text,acknowledged:true}));
}
const signed=(svc,s,owner='owner')=>{const r=svc.handoff(owner,s.id,cmd(s,{platformId:'A',consent:true}));return {r,token:new URL(r.handoff.url).searchParams.get('judge_token')};};

test('manifest validates IDs, duplicate keys, event contracts, and insecure URLs',()=>{
 assert.deepEqual(validatePlatformManifest(config),config);
 assert.throws(()=>validatePlatformManifest([...config,...config]),x=>x.code==='CONFIG');
 assert.throws(()=>validatePlatformManifest([{...config[0],confirmedEvents:['ad_created','ad_created']}]),x=>x.code==='CONFIG');
 assert.throws(()=>validatePlatformManifest([{...config[0],credentialEnv:'bad-name'}]),x=>x.code==='CONFIG');
 for(const url of ['http://partner.example.com','https://127.0.0.1/import','https://[::1]/import','https://user:pass@example.com/import','https://localhost/import','https://127.0.0.1.example.com#fragment','https://127.0.0.1:8443/import','https://evil.local/import','https://example.com:444/import']){
  if(url.startsWith('https://127.0.0.1.example.com')&&!url.includes('#'))continue;
  assert.equal(validReceiverURL(url),false,url);
 }
 assert.equal(validReceiverURL('https://partner.example.com/import'),true);
});
test('diagnostic returns readiness and reasons without exposing credential or signing secret',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v03-manifest-'));
 try{
  const file=join(dir,'manifest.json');writeFileSync(file,JSON.stringify(config));
  const report=diagnosePlatformFile(file,{env:{[ID]:CRED},secret:SECRET});
  assert.equal(report.total,1);assert.equal(report.configured,1);
  const serialized=JSON.stringify(report);assert.ok(!serialized.includes(CRED));assert.ok(!serialized.includes(SECRET));
  const missing=integrationReadiness(config[0],{env:{},secret:''});assert.equal(missing.configured,false);assert.ok(missing.reasons.length>=2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('handoff records immutable verdict version and exposes only safe history to owner',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r}=signed(svc,v.state);
 assert.equal(r.handoff.mode,'deeplink');
 assert.equal(r.handoffs[0].verdict_id,v.state.verdictId);
 assert.ok(!JSON.stringify(svc.detail('owner',v.state.id)).includes('judge_token'));
 assert.equal(r.handoffs[0].redeemed_at,null);assert.equal(r.handoffs[0].confirmed_actions,0);
 assert.deepEqual(replay(r.events),r.state);
});
test('owner can revoke signed handoff before redeem; action is auditable and link cannot be redeemed',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 const revoked=svc.revokeHandoff('owner',v.state.id,cmd(r.state,{handoffId:r.handoff.id}));
 assert.equal(revoked.handoffs[0].revoked_at!==null,true);
 assert.equal(revoked.events.at(-1).type,'handoff_revoked');
 assert.ok(revoked.audit.consistent);
 assert.throws(()=>svc.redeem('A',CRED,token),e=>e.code==='REVOKED');
 assert.equal(svc.stats('owner').useful_action,undefined);
});
test('handoff revoke owner isolation and replay prevention',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r}=signed(svc,v.state);
 assert.throws(()=>svc.revokeHandoff('outsider',v.state.id,cmd(r.state,{handoffId:r.handoff.id})),x=>x.code==='NOT_FOUND');
 const q=svc.revokeHandoff('owner',v.state.id,cmd(r.state,{handoffId:r.handoff.id}));
 assert.throws(()=>svc.revokeHandoff('owner',v.state.id,cmd(q.state,{handoffId:r.handoff.id})),x=>x.code==='REVOKED');
});
test('owner reopen invalidates outstanding signed handoffs',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 const reopened=svc.reopen('owner',v.state.id,cmd(r.state));
 assert.ok(reopened.handoffs[0].revoked_at);
 assert.throws(()=>svc.redeem('A',CRED,token),e=>e.code==='REVOKED');
});
test('witness objection also invalidates unredeemed signed handoffs',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 const invite=svc.invite('owner',v.state.id,cmd(r.state,{consent:true}));
 svc.object('witness',invite.invite.token,{text:'Why would I believe this claim without a real example?'});
 assert.throws(()=>svc.redeem('A',CRED,token),e=>e.code==='REVOKED');
 assert.equal(svc.own('owner',v.state.id).phase,'reopened');
});
test('once redeemed, a handoff cannot be retracted from the receiving platform',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 svc.redeem('A',CRED,token);
 const s=svc.own('owner',v.state.id);
 assert.throws(()=>svc.revokeHandoff('owner',v.state.id,cmd(s,{handoffId:r.handoff.id})),e=>e.code==='ALREADY_REDEEMED');
 assert.equal(svc.detail('owner',v.state.id).handoffs[0].redeemed_at!==null,true);
});
test('unversioned legacy handoffs fail closed after migration',t=>{
 const {svc,store}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 store.run('UPDATE handoffs SET verdict_id=NULL WHERE id=?',r.handoff.id);
 assert.throws(()=>svc.redeem('A',CRED,token),e=>e.code==='STALE_VERDICT');
});
test('one partner event is counted once, different payload with reused eventId is rejected',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 svc.redeem('A',CRED,token);
 const ev={handoffId:r.handoff.id,eventId:'tested-event-123',action:'ad_created'};
 assert.deepEqual(svc.receipt('A',CRED,ev),{ok:true,duplicate:false});
 assert.deepEqual(svc.receipt('A',CRED,ev),{ok:true,duplicate:true});
 assert.throws(()=>svc.receipt('A',CRED,{...ev,action:'ad_exported'}),e=>e.code==='EVENT_CONFLICT');
 assert.equal(svc.stats('owner').useful_action,1);
 assert.equal(svc.detail('owner',v.state.id).handoffs[0].confirmed_actions,1);
});
test('a duplicate external event ID cannot be reassigned to another handoff',t=>{
 const {svc}=fixture(t),v=verdict(svc),first=signed(svc,v.state),second=signed(svc,first.r.state);
 svc.redeem('A',CRED,first.token);svc.redeem('A',CRED,second.token);
 const ev={handoffId:first.r.handoff.id,eventId:'reused-event-777',action:'ad_created'};
 svc.receipt('A',CRED,ev);
 assert.throws(()=>svc.receipt('A',CRED,{...ev,handoffId:second.r.handoff.id}),e=>e.code==='EVENT_CONFLICT');
});
test('invalid credentials, unknown events, and tampered tokens do not count platform outcome',t=>{
 const {svc}=fixture(t),v=verdict(svc),{r,token}=signed(svc,v.state);
 assert.throws(()=>svc.redeem('A','wrong',token),e=>e.code==='AUTH');
 assert.throws(()=>svc.redeem('A',CRED,token+'tampered'),e=>e.code==='TOKEN');
 assert.throws(()=>svc.receipt('A',CRED,{handoffId:r.handoff.id,eventId:'event-111111',action:'arbitrary'}),e=>e.code==='EVENT_CONTRACT');
 assert.equal(svc.stats('owner').useful_action,undefined);
});
test('upgrades schema v1 in place and preserves an issued verdict',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v03-upgrade-'));
 let store;
 try{
  const file=join(dir,'pilot.sqlite');store=new Store(file);
  const svc=new JudgeService(store),v=verdict(svc);
  store.db.exec('ALTER TABLE handoffs DROP COLUMN verdict_id; ALTER TABLE handoffs DROP COLUMN revoked_at; ALTER TABLE integration_receipts DROP COLUMN action; PRAGMA user_version=1;');
  store.close();store=null;
  store=new Store(file);
  assert.equal(store.one('PRAGMA user_version').user_version,28);
  assert.deepEqual(new JudgeService(store).detail('owner',v.state.id).state,v.state);
  assert.ok(store.all('PRAGMA table_info(handoffs)').some(x=>x.name==='verdict_id'));
  store.close();store=null;
  store=new Store(file);assert.equal(store.one('PRAGMA user_version').user_version,28);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('runtime refuses exposing plain HTTP outside loopback even when APP_ORIGIN is localhost',()=>{
 const store=new Store(':memory:');try{
  assert.throws(()=>createApp({host:'0.0.0.0',port:3000,origin:'http://localhost:3000',store}),/insecure HTTP/);
  assert.throws(()=>createApp({host:'127.0.0.1',port:3000,origin:'http://public.example.com',store}),/HTTPS/);
  assert.throws(()=>createApp({host:'127.0.0.1',port:3000,origin:'http://localhost:3000/a',store}),/clean http/);
 }finally{store.close();}
});

async function launch(t){
 const former=process.env[ID];process.env[ID]=CRED;
 const store=new Store(':memory:');const app=createApp({store,origin:'http://localhost:3000',port:3000,host:'127.0.0.1',secret:SECRET,platforms:config});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{app.server.close(()=>{store.close();if(former===undefined)delete process.env[ID];else process.env[ID]=former;resolve();});app.server.closeAllConnections();}));
 return {app,url:`http://127.0.0.1:${app.server.address().port}`};
}
function req(url,path,body=null,headers={}){
 return new Promise((resolve,reject)=>{
  const content=body===null?null:JSON.stringify(body);
  const r=http.request(url+path,{method:content===null?'GET':'POST',headers:{Host:'localhost:3000',...(content===null?{}:{'Content-Type':'application/json'}),...headers}},res=>{
    const out=[];res.on('data',x=>out.push(x));res.on('end',()=>{const h={...res.headers};resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(out).toString()),headers:h});});
  });r.on('error',reject);if(content)r.write(content);r.end();
 });
}
test('real HTTP integration endpoints enforce bearer, once-only redeem, and idempotent receipts',async t=>{
 const {app,url}=await launch(t);
 const v=verdict(app.svc),{r,token}=signed(app.svc,v.state);
 let a=await req(url,'/api/integrations/redeem',{platformId:'A',token},{Authorization:'Bearer wrong'});
 assert.equal(a.status,401);
 a=await req(url,'/api/integrations/redeem',{platformId:'A',token},{Authorization:'Bearer '+CRED});
 assert.equal(a.status,200);assert.equal(a.data.handoffId,r.handoff.id);
 a=await req(url,'/api/integrations/redeem',{platformId:'A',token},{Authorization:'Bearer '+CRED});
 assert.equal(a.status,409);
 const event={platformId:'A',handoffId:r.handoff.id,eventId:'partner-http-event-1',action:'ad_created'};
 a=await req(url,'/api/integrations/events',event,{Authorization:'Bearer '+CRED});assert.deepEqual(a.data,{ok:true,duplicate:false});
 a=await req(url,'/api/integrations/events',event,{Authorization:'Bearer '+CRED});assert.deepEqual(a.data,{ok:true,duplicate:true});
 assert.equal(app.svc.stats('owner').useful_action,1);
});
