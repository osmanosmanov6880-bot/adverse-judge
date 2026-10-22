import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {deviceLabel} from '../server/security.mjs';
import {DEMOS} from '../shared/domain.mjs';
const CRED='isolated-partner-credential-1249238423',SECRET='test-signing-secret-very-long-and-unique-1283456',KEY='JUDGE_V04_PARTNER_KEY';
const platforms=[{id:'A',name:'contract test',mode:'deeplink',verified:true,url:'https://verified.example.com/import',credentialEnv:KEY,confirmedEvents:['ad_created']}];
const cmd=(s,b={})=>({commandId:randomUUID(),expectedVersion:s.version,...b});
function issue(svc){const o='owner';let x=svc.create(o,{claim:DEMOS[0].claim,draft:DEMOS[0]});x=svc.act(o,x.state.id,cmd(x.state,{action:'narrow'}));x=svc.prepare(o,x.state.id,cmd(x.state,{draft:DEMOS[0]}));return svc.verdict(o,x.state.id,cmd(x.state,{claim:x.state.candidates[0].text,acknowledged:true}));}
function fixture(t){const old=process.env[KEY];process.env[KEY]=CRED;const store=new Store(':memory:');t.after(()=>{store.close();if(old===undefined)delete process.env[KEY];else process.env[KEY]=old;});return {store,svc:new JudgeService(store,{platforms,secret:SECRET})};}
test('receiver retries lost response for 5m using same request ID without duplicate ledger event',t=>{
 const {svc,store}=fixture(t);let x=issue(svc);x=svc.handoff('owner',x.state.id,cmd(x.state,{platformId:'A',consent:true}));
 const id=x.handoff.id,token=new URL(x.handoff.url).searchParams.get('judge_token');
 const one=svc.redeem('A',CRED,token,'unique-remote-request-01');
 const two=svc.redeem('A',CRED,token,'unique-remote-request-01');
 assert.equal(one.duplicate,false);assert.equal(two.duplicate,true);assert.deepEqual(one.brief,two.brief);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM events WHERE type=?','handoff_redeemed').n,1);
 assert.throws(()=>svc.redeem('A',CRED,token,'another-remote-request-01'),e=>e.code==='REDEEMED');
 assert.throws(()=>svc.redeem('A',CRED,token),e=>e.code==='REDEEMED');
 assert.throws(()=>svc.redeem('A',CRED,token,'bad'),e=>e.code==='REQUEST_ID');
 assert.equal(svc.receipt('A',CRED,{handoffId:id,eventId:'ad-object-created-1',action:'ad_created'}).duplicate,false);
 assert.equal(svc.stats('owner').useful_action,1);
});
test('receiver idempotency is bounded by 5-minute window and stale verdict',t=>{
 let now=Date.parse('2026-10-22T01:00:00Z');const {store}=fixture(t);
 const svc=new JudgeService(store,{platforms,secret:SECRET,clock:()=>now});
 let x=issue(svc);x=svc.handoff('owner',x.state.id,cmd(x.state,{platformId:'A',consent:true}));
 const token=new URL(x.handoff.url).searchParams.get('judge_token');
 svc.redeem('A',CRED,token,'receiver-retry-key-A');now+=301000;
 assert.throws(()=>svc.redeem('A',CRED,token,'receiver-retry-key-A'),e=>e.code==='REDEEMED');
});
test('migration from v2 leaves user sessions and cases intact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v04-upgrade-'));let store;
 try{
  const file=join(dir,'judge.sqlite');store=new Store(file);const id=issue(new JudgeService(store)).state.id;
  store.db.exec('ALTER TABLE sessions DROP COLUMN device_label; ALTER TABLE sessions DROP COLUMN last_seen_at; ALTER TABLE handoffs DROP COLUMN redeem_request_hash; DROP TABLE auth_failures; PRAGMA user_version=2');
  store.close();store=new Store(file);
  assert.equal(store.one('PRAGMA user_version').user_version,28);
  assert.ok(store.one('SELECT id FROM cases WHERE id=?',id));
  for(const [table,col] of [['sessions','device_label'],['sessions','last_seen_at'],['handoffs','redeem_request_hash']]) assert.ok(store.all(`PRAGMA table_info(${table})`).some(x=>x.name===col));
  assert.ok(store.one('SELECT name FROM sqlite_master WHERE name=?','auth_failures'));
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('coarse device label does not retain arbitrary agent strings',()=>{
 assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124.0'), 'Windows · Chrome');
 assert.equal(deviceLabel('Safari/17.0 (iPhone; secret=private)'),'iOS · Safari');
 assert.ok(!deviceLabel('custom-auth-secret-abc').includes('abc'));
});
async function app(t){const store=new Store(':memory:');const a=createApp({store,port:3000,origin:'http://localhost:3000',env:{}});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{a.server.close(()=>{store.close();r();});a.server.closeAllConnections();}));return {url:`http://127.0.0.1:${a.server.address().port}`,store};}
async function req(url,path,{method='GET',cookie,csrf,body,userAgent}={}){
 return new Promise((resolve,reject)=>{const headers={Host:'localhost:3000',...(cookie?{Cookie:cookie}:{}),...(userAgent?{'User-Agent':userAgent}:{}),...(method==='POST'?{Origin:'http://localhost:3000','Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})}:{})};const q=http.request(url+path,{method,headers},res=>{const chunks=[];res.on('data',p=>chunks.push(p));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode,data:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});});q.on('error',reject);if(body!==undefined)q.write(JSON.stringify(body));q.end();});
}
async function guest(url,ua){const r=await req(url,'/api/bootstrap',{userAgent:ua});return {cookie:r.cookie,csrf:r.data.csrf};}
async function register(url,s,email='security@example.com',password='initial-long-test-password'){
 const r=await req(url,'/api/auth/register',{method:'POST',...s,body:{email,password,accepted:true}});assert.equal(r.status,201,JSON.stringify(r.data));return {cookie:r.cookie,csrf:r.data.csrf};
}
async function login(url,s,email='security@example.com',password='initial-long-test-password'){
 return req(url,'/api/auth/login',{method:'POST',...s,body:{email,password}});
}
test('registered user can list sessions and revoke a different device, not another account',async t=>{
 const {url}=await app(t);const s=await guest(url,'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
 assert.equal((await req(url,'/api/auth/sessions',{cookie:s.cookie})).status,403);
 const owner=await register(url,s),s2=await guest(url,'Mozilla/5.0 (iPhone) Safari/17'),signed=await login(url,s2);
 assert.equal(signed.status,200);const second=signed.cookie;
 const list=await req(url,'/api/auth/sessions',{cookie:owner.cookie});assert.equal(list.status,200);
 assert.equal(list.data.sessions.length,2);assert.equal(list.data.sessions.find(x=>x.current).device,'Неизвестное устройство · браузер');
 const foreign=list.data.sessions.find(x=>!x.current);assert.ok(foreign.id);
 const other=await guest(url);
 assert.equal((await req(url,'/api/auth/sessions/revoke',{method:'POST',...other,body:{id:foreign.id}})).status,403);
 const revoked=await req(url,'/api/auth/sessions/revoke',{method:'POST',...owner,body:{id:foreign.id}});
 assert.equal(revoked.status,200);assert.equal(revoked.data.loggedOut,false);
 assert.equal((await req(url,'/api/auth/sessions',{cookie:second})).status,401);
 assert.equal((await req(url,'/api/auth/sessions',{cookie:owner.cookie})).status,200);
});
test('changing password invalidates other sessions and rotates current token and csrf',async t=>{
 const {url}=await app(t),guestOne=await guest(url),owner=await register(url,guestOne),guestTwo=await guest(url),signed=await login(url,guestTwo);
 assert.equal(signed.status,200);
 const bad=await req(url,'/api/auth/password',{method:'POST',...owner,body:{currentPassword:'wrong-test-password',newPassword:'very-new-long-password'}});assert.equal(bad.status,401);
 const changed=await req(url,'/api/auth/password',{method:'POST',...owner,body:{currentPassword:'initial-long-test-password',newPassword:'very-new-long-password'}});
 assert.equal(changed.status,200);assert.ok(changed.cookie);assert.notEqual(changed.cookie,owner.cookie);assert.notEqual(changed.data.csrf,owner.csrf);
 assert.equal((await req(url,'/api/auth/sessions',{cookie:signed.cookie})).status,401);
 assert.equal((await req(url,'/api/auth/sessions',{cookie:owner.cookie})).status,401);
 assert.equal((await req(url,'/api/auth/sessions',{cookie:changed.cookie})).status,200);
 const guestThree=await guest(url),old=await login(url,guestThree);assert.equal(old.status,401);
 const next=await login(url,guestThree,'security@example.com','very-new-long-password');assert.equal(next.status,200);
});
test('failed-login throttling is persisted in database and continues across a new session',async t=>{
 const {url,store}=await app(t);const owner=await register(url,await guest(url));
 for(let i=0;i<8;i++){
  const s=await guest(url);const res=await login(url,s,'security@example.com','incorrect-password');assert.equal(res.status,401);
 }
 assert.equal(store.one('SELECT attempts FROM auth_failures').attempts,8);
 const s=await guest(url);
 const locked=await login(url,s);assert.equal(locked.status,429);assert.equal(locked.data.error.code,'LOGIN_LOCKED');
 const others=await guest(url);
 assert.equal((await login(url,others,'unknown@example.com','incorrect-password')).status,401);
});
test('privacy delete removes active account and its login-failure counter',async t=>{
 const {url,store}=await app(t),owner=await register(url,await guest(url));
 const guestTwo=await guest(url);assert.equal((await login(url,guestTwo,'security@example.com','wrong-old-password')).status,401);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM auth_failures').n,1);
 const del=await req(url,'/api/privacy/delete',{method:'POST',...owner,body:{confirm:'DELETE'}});
 assert.equal(del.status,200);assert.equal(store.one('SELECT COUNT(*) AS n FROM auth_failures').n,0);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM users').n,0);
});
