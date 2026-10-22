import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
import {generateCommentary,modelStatus} from '../server/llm.mjs';
import {DEMOS,initialState} from '../shared/domain.mjs';

async function launch(t,options={}){const store=new Store(':memory:');const app=createApp({store,port:3000,origin:'http://localhost:3000',env:{},...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(resolve=>{app.server.close(()=>{store.close();resolve();});app.server.closeAllConnections();}));const url=`http://127.0.0.1:${app.server.address().port}`;return {url,app};}
async function request(url,path,options={}){
 return new Promise((resolve,reject)=>{
  const req=http.request(url+path,{method:options.method||'GET',headers:{Host:'localhost:3000',...options.headers}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const body=Buffer.concat(chunks).toString();const headers=new Headers();for(const [k,v] of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);resolve({status:res.statusCode,headers,json:async()=>JSON.parse(body)});});
  });req.on('error',reject);if(options.body)req.write(options.body);req.end();
 });
}
async function session(url){const r=await request(url,'/api/bootstrap');const data=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrf};}
function postHeaders(s){return {'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf,Origin:'http://localhost:3000'};}
test('bootstrap issues HttpOnly SameSite cookie and security headers',async t=>{const {url}=await launch(t);const r=await request(url,'/api/bootstrap');assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');const b=await r.json();assert.equal(b.platforms.length,7);assert.equal(b.ai.enabled,false);});
test('foreign Origin cannot create a case',async t=>{const {url}=await launch(t),s=await session(url);const r=await request(url,'/api/cases',{method:'POST',headers:{...postHeaders(s),Origin:'https://evil.example'},body:JSON.stringify({claim:'Untrusted claim'})});assert.equal(r.status,403);assert.equal((await r.json()).error.code,'ORIGIN');});
test('missing CSRF cannot create a case',async t=>{const {url}=await launch(t),s=await session(url);const headers=postHeaders(s);delete headers['X-CSRF-Token'];const r=await request(url,'/api/cases',{method:'POST',headers,body:'{"claim":"Test claim"}'});assert.equal(r.status,403);});
test('unexpected Host is rejected',async t=>{const {url}=await launch(t);const r=await request(url,'/api/health',{headers:{Host:'evil.example'}});assert.equal(r.status,403);});
test('non JSON body is rejected',async t=>{const {url}=await launch(t),s=await session(url);const r=await request(url,'/api/cases',{method:'POST',headers:{...postHeaders(s),'Content-Type':'text/plain'},body:'test'});assert.equal(r.status,415);});
test('malformed JSON is rejected without server trace',async t=>{const {url}=await launch(t),s=await session(url);const r=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:'{bad'});assert.equal(r.status,400);assert.equal((await r.json()).error.code,'JSON');});
test('oversize body is rejected',async t=>{const {url}=await launch(t),s=await session(url);const r=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:JSON.stringify({claim:'x'.repeat(40000)})});assert.equal(r.status,413);});
test('guest creation and owner isolation over HTTP',async t=>{const {url}=await launch(t),s=await session(url),other=await session(url);const created=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:JSON.stringify({claim:DEMOS[0].claim,draft:DEMOS[0]})});assert.equal(created.status,201);const {state}=await created.json();const own=await request(url,'/api/cases/'+state.id,{headers:{Cookie:s.cookie}});assert.equal(own.status,200);const denied=await request(url,'/api/cases/'+state.id,{headers:{Cookie:other.cookie}});assert.equal(denied.status,404);});
test('account registration rotates session; login retains access',async t=>{const {url}=await launch(t);let s=await session(url);const create=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:'{"claim":"A useful product claim"}'});const id=(await create.json()).state.id;const r=await request(url,'/api/auth/register',{method:'POST',headers:postHeaders(s),body:JSON.stringify({email:'qa@example.com',password:'long-password-for-test',accepted:true})});assert.equal(r.status,201);const rotated=r.headers.get('set-cookie').split(';')[0];assert.notEqual(rotated,s.cookie);assert.equal((await request(url,'/api/cases/'+id,{headers:{Cookie:s.cookie}})).status,401);const s2=await session(url);const login=await request(url,'/api/auth/login',{method:'POST',headers:postHeaders(s2),body:JSON.stringify({email:'qa@example.com',password:'long-password-for-test'})});assert.equal(login.status,200);const c=login.headers.get('set-cookie').split(';')[0];assert.equal((await request(url,'/api/cases/'+id,{headers:{Cookie:c}})).status,200);});
test('unconfigured external AI fails honestly',async t=>{const {url}=await launch(t),s=await session(url);const c=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:'{"claim":"A useful product claim"}'}),id=(await c.json()).state.id;const r=await request(url,`/api/cases/${id}/ai`,{method:'POST',headers:postHeaders(s),body:JSON.stringify({consent:true,expectedVersion:1,commandId:'test-command-1'})});assert.equal(r.status,503);assert.equal((await r.json()).error.code,'AI_DISABLED');});
test('static allowlist never serves secret paths',async t=>{const {url}=await launch(t);for(const p of ['/.env','/server/index.mjs','/config/platforms.json','/data/judge.sqlite'])assert.equal((await request(url,p)).status,404);});

const state=initialState({id:'test',claim:'This is a product claim',createdAt:'2026-10-22T00:00:00Z'});
const env={OPENAI_API_KEY:'test-placeholder',OPENAI_MODEL:'model-under-test',JUDGE_ALLOW_REMOTE_AI:'true'};
function fakeOutput(text){return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})};}
test('AI is disabled without all explicit settings',()=>{assert.equal(modelStatus({}).enabled,false);assert.equal(modelStatus({OPENAI_API_KEY:'x',OPENAI_MODEL:'x'}).enabled,false);assert.equal(modelStatus(env).enabled,true);});
test('Responses adapter has store false, strict schema, no tools',async()=>{let sent;const out=await generateCommentary(state,{env,fetcher:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(init.body);return fakeOutput(JSON.stringify({lex:'A clear question.',aurora:'A useful reframing.',witness:'What do I get?'}));}});assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.tools,undefined);assert.equal(out.source,'openai-responses');assert.equal(state.phase,'hearing');});
test('malformed model output cannot become commentary',async()=>{await assert.rejects(()=>generateCommentary(state,{env,fetcher:async()=>fakeOutput('not JSON')}),x=>x.code==='AI_FORMAT');await assert.rejects(()=>generateCommentary(state,{env,fetcher:async()=>fakeOutput('{"lex":"x","aurora":"y","witness":"z","phase":"verdict"}')}),x=>x.code==='AI_FORMAT');});
test('provider failure does not leak secrets',async()=>{await assert.rejects(()=>generateCommentary(state,{env,fetcher:async()=>({ok:false})}),x=>x.code==='AI_UNAVAILABLE'&&!x.message.includes(env.OPENAI_API_KEY));});
test('provider refusal is explicit',async()=>{await assert.rejects(()=>generateCommentary(state,{env,fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]})})}),x=>x.code==='AI_REFUSED');});
test('incomplete response is explicit',async()=>{await assert.rejects(()=>generateCommentary(state,{env,fetcher:async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})}),x=>x.code==='AI_INCOMPLETE');});
test('replayed AI command never repeats the provider call',async t=>{
 let calls=0;
 const {url}=await launch(t,{env,commentator:async()=>{calls++;return {source:'test-provider',model:'test',commentary:{lex:'Question',aurora:'Defense',witness:'Buyer question'}};}});
 const s=await session(url);
 const c=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:'{"claim":"A useful product claim"}'});
 const id=(await c.json()).state.id;
 const body=JSON.stringify({consent:true,expectedVersion:1,commandId:'stable-ai-command-001'});
 const first=await request(url,`/api/cases/${id}/ai`,{method:'POST',headers:postHeaders(s),body});
 assert.equal(first.status,200);
 const second=await request(url,`/api/cases/${id}/ai`,{method:'POST',headers:postHeaders(s),body});
 assert.equal(second.status,200);assert.equal((await second.json()).duplicate,true);assert.equal(calls,1);
});
test('in-flight duplicate AI request is reserved before the external call',async t=>{
 let release;const gate=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);let calls=0;
 const {url}=await launch(t,{env,commentator:async()=>{calls++;entered();await gate;return {source:'test',commentary:{lex:'a',aurora:'b',witness:'c'}};}});
 const s=await session(url);const c=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:'{"claim":"A useful product claim"}'});const id=(await c.json()).state.id;
 const body=JSON.stringify({consent:true,expectedVersion:1,commandId:'stable-ai-command-002'});
 const first=request(url,`/api/cases/${id}/ai`,{method:'POST',headers:postHeaders(s),body});await started;
 const second=await request(url,`/api/cases/${id}/ai`,{method:'POST',headers:postHeaders(s),body});
 assert.equal(second.status,409);assert.equal((await second.json()).error.code,'AI_ALREADY_ATTEMPTED');release();assert.equal((await first).status,200);assert.equal(calls,1);
});
test('owner-only analytics counts distinct cases and returns no invented platform outcome',async t=>{
 const {url}=await launch(t),s=await session(url),other=await session(url);
 const r=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:JSON.stringify({claim:'Лучший сервис для всех'})});assert.equal(r.status,201);
 const mine=await request(url,'/api/analytics',{headers:{Cookie:s.cookie}});const a=await mine.json();assert.equal(a.funnel[0].count,1);assert.equal(a.funnel[6].count,0);
 const theirs=await request(url,'/api/analytics',{headers:{Cookie:other.cookie}});assert.equal((await theirs.json()).funnel[0].count,0);
});
test('owner-only structured brief requires verdict and retains provenance',async t=>{
 const {url}=await launch(t),s=await session(url),other=await session(url);
 let r=await request(url,'/api/cases',{method:'POST',headers:postHeaders(s),body:JSON.stringify({claim:DEMOS[0].claim,draft:DEMOS[0]})});let {state}=await r.json();const id=state.id;
 assert.equal((await request(url,`/api/cases/${id}/brief`,{headers:{Cookie:s.cookie}})).status,409);
 const command=async(action,payload)=>{const reply=await request(url,`/api/cases/${id}/${action}`,{method:'POST',headers:postHeaders(s),body:JSON.stringify({commandId:'command-'+Math.random().toString(36).slice(2),expectedVersion:state.version,...payload})});assert.equal(reply.status,200,action);const json=await reply.json();state=json.state;return json;};
 await command('action',{action:'narrow'});await command('brief',{draft:DEMOS[0]});await command('verdict',{claim:'Готовый рекламный материал для вашего малого бизнеса',acknowledged:true});
 const response=await request(url,`/api/cases/${id}/brief`,{headers:{Cookie:s.cookie}});assert.equal(response.status,200);
 const output=await response.json();assert.equal(output.brief.schemaVersion,'judge-brief-1');assert.equal(output.brief.evidence.status,'user_supplied_unverified');
 assert.equal((await request(url,`/api/cases/${id}/brief`,{headers:{Cookie:other.cookie}})).status,404);
 assert.equal((await request(url,`/api/cases/${id}/audit`,{headers:{Cookie:s.cookie}})).status,200);
 await command('reopen',{});
 assert.equal((await request(url,`/api/cases/${id}/brief`,{headers:{Cookie:s.cookie}})).status,409);
});
