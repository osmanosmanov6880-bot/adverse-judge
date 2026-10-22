import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {CinemaBridge,validateCinemaBrief,cinemaFingerprint} from '../server/cinema-bridge.mjs';
// Load the embedded browser UMD modules in isolation: no sibling checkout needed.
const window = {};
for (const name of ['data.js','engine.js']) {
  const script=readFileSync(new URL('../cinema/src/'+name,import.meta.url),'utf8');
  runInNewContext(script,{window,console});
}
const D=window.CINEMA_DATA,E=window.CINEMA_ENGINE;
const realBrief={schema:'adverse.cinematic-brief.v1',origin:'ADVERSE JUDGE · THE TRIAL OF PROMISES',reviewStatus:'draft_requires_human_and_legal_review',claim:{original:'Удвоим ваши продажи за 7 дней гарантированно',revised:'Для малого бизнеса: инструменты подготовки рекламы с понятными условиями.',selectedStrategy:D.strategies.clarity.label},evidence:{status:'missing',description:null},witness:'conditions',editorialHeuristics:{score:100,rating:'Approved, guaranteed'},narrative:{visitedScenes:['scene_001']},handoff:{method:'manual_export_only',externalPlatformConnected:false}};
async function launch(t) {
 const store=new Store(':memory:');const app=createApp({store,origin:'http://localhost:3000',port:3000,env:{}});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>{app.server.close(()=>{store.close();ok();});app.server.closeAllConnections();}));
 return {url:'http://127.0.0.1:'+app.server.address().port,store};
}
async function req(url,path,method='GET',body=null,headers={}){
 return new Promise((resolve,reject)=>{
  const serialized=body===null?null:JSON.stringify(body);
  const r=http.request(url+path,{method,headers:{Host:'localhost:3000',...headers,...(serialized===null?{}:{'Content-Length':Buffer.byteLength(serialized)})}},res=>{
   const arr=[];res.on('data',x=>arr.push(x));res.on('end',()=>{const text=Buffer.concat(arr).toString();let json;try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,headers:res.headers,text,json});});
  });r.on('error',reject);if(serialized!==null)r.write(serialized);r.end();
 });
}
async function session(url){const r=await req(url,'/api/bootstrap');return {cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.json.csrf};}
function head(s){return {'Content-Type':'application/json',Origin:'http://localhost:3000',Cookie:s.cookie,'X-CSRF-Token':s.csrf};}
const payload={consent:true,brief:realBrief};
test('cinema bridge validates draft-only contracts and ignores screenplay scores',()=>{
 const n=validateCinemaBrief(payload);assert.equal(n.strategy,D.strategies.clarity.label);assert.equal(Object.hasOwn(n,'editorialHeuristics'),false);
 assert.match(cinemaFingerprint(n),/^[a-f0-9]{64}$/);
 assert.throws(()=>validateCinemaBrief({...payload,consent:false}),/Подтвердите/);
 assert.throws(()=>validateCinemaBrief({consent:true,brief:{...realBrief,reviewStatus:'approved'}}),/черновой/);
 assert.throws(()=>validateCinemaBrief({consent:true,brief:{...realBrief,evidence:{status:'verified',description:'secret'}}}),/статус/);
});
test('hosted cinematic path serves actual JS, image, favicon and rejects traversal',async t=>{
 const {url}=await launch(t);
 for(const [path,type] of [['/cinema/','text/html'],['/cinema/src/engine.js','text/javascript'],['/cinema/src/style.css','text/css'],['/cinema/assets/hall-mobile.webp','image/webp'],['/cinema/assets/favicon.svg','image/svg+xml']]){
  const r=await req(url,path);assert.equal(r.status,200,path);assert.ok(r.headers['content-type'].startsWith(type),r.headers['content-type']);assert.ok(r.text.length>25);
 }
 for(const path of ['/cinema/../../.env','/cinema/src/not-real.js','/cinema/assets/secret.env','/cinema/dist/ADVERSE-JUDGE-CINEMA-STANDALONE.html'])assert.equal((await req(url,path)).status,404,path);
});
test('explicit consent and CSRF prevent cross-site movie-to-JUDGE imports',async t=>{
 const {url}=await launch(t),s=await session(url);
 assert.equal((await req(url,'/api/cinema/import','POST',payload,{...head(s),Origin:'https://attacker.example'})).status,403);
 assert.equal((await req(url,'/api/cinema/import','POST',payload,{...head(s),'X-CSRF-Token':'fake'})).status,403);
 assert.equal((await req(url,'/api/cinema/import','POST',{...payload,consent:false},head(s))).status,400);
 assert.equal((await req(url,'/api/cases','GET',null,{Cookie:s.cookie})).json.cases.length,0);
});
test('real cinematic export creates only an unapproved hearing case, is idempotent, isolated and included in export',async t=>{
 const {url,store}=await launch(t),s=await session(url),other=await session(url);
 const first=await req(url,'/api/cinema/import','POST',payload,head(s));assert.equal(first.status,201,first.text);const id=first.json.caseId;
 assert.equal(first.json.created,true);assert.match(id,/^[a-f0-9-]{36}$/);
 const snapshot=await req(url,'/api/cases/'+id,'GET',null,{Cookie:s.cookie});assert.equal(snapshot.status,200);
 assert.equal(snapshot.json.state.phase,'hearing');assert.equal(snapshot.json.state.finalClaim,null);assert.equal(snapshot.json.state.verdictId,null);
 assert.equal(snapshot.json.cinemaImport.proposedClaim,realBrief.claim.revised);
 assert.equal(snapshot.json.cinemaImport.evidenceStatus,'missing');
 assert.equal(snapshot.json.events.length,1);assert.equal(snapshot.json.events[0].type,'case_created');
 assert.equal(snapshot.json.audit.consistent,true);
 assert.equal((await req(url,'/api/cases/'+id,'GET',null,{Cookie:other.cookie})).status,404);
 const rerun=await req(url,'/api/cinema/import','POST',payload,head(s));assert.equal(rerun.status,201);assert.equal(rerun.json.created,false);assert.equal(rerun.json.caseId,id);
 assert.equal(store.one('SELECT COUNT(*) as n FROM cases WHERE owner_id=?',store.one('SELECT owner_id FROM cases WHERE id=?',id).owner_id).n,1);
 const otherImport=await req(url,'/api/cinema/import','POST',payload,head(other));assert.equal(otherImport.status,201);assert.notEqual(otherImport.json.caseId,id);
 const exported=await req(url,'/api/privacy/export','GET',null,{Cookie:s.cookie});assert.equal(exported.status,200);assert.equal(exported.json.cinemaImports.length,1);
 assert.equal(exported.json.cinemaImports[0].proposedClaim,realBrief.claim.revised);
 const deletion=await req(url,'/api/cases/'+id,'DELETE',{},head(s));assert.equal(deletion.status,200,deletion.text);
 assert.equal(store.one('SELECT * FROM cinema_imports WHERE case_id=?',id),undefined);
 const importAgain=await req(url,'/api/cinema/import','POST',payload,head(s));assert.equal(importAgain.json.created,true);
});
test('imports reject untrusted special fields and store quote as harmless text',async t=>{
 const {url}=await launch(t),s=await session(url);
 const injection='<img src=x onerror=alert(1)> мы предлагаем честные условия';
 const p={consent:true,brief:{...realBrief,claim:{...realBrief.claim,revised:injection}}};
 const r=await req(url,'/api/cinema/import','POST',p,head(s));assert.equal(r.status,201);
 const saved=await req(url,'/api/cases/'+r.json.caseId,'GET',null,{Cookie:s.cookie});assert.equal(saved.json.cinemaImport.proposedClaim,injection);
 assert.equal(saved.json.state.finalClaim,null);
 const wrong={consent:true,brief:{...realBrief,claim:{...realBrief.claim,revised:123}}};assert.equal((await req(url,'/api/cinema/import','POST',wrong,head(s))).status,400);
});
test('CINEMA actual engine brief can be parsed by server without trusting generated rating',()=>{
 const sample=E.fresh();sample.rewrite=realBrief.claim.revised;sample.claim=realBrief.claim.original;sample.verdictIssued=true;sample.strategy='clarity';sample.evidenceStatus='missing';sample.witness='conditions';
 const output=E.brief(sample);assert.equal(validateCinemaBrief({consent:true,brief:output}).original,realBrief.claim.original);
});
