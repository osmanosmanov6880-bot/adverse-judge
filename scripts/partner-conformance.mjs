/** Wave 4: real HTTP sandbox over loopback — not a claim of connectivity to platforms A–G. */
import {Store} from '../server/store.mjs';
import {createApp} from '../server/index.mjs';
import {createJudgeReceiver} from '../integrations/receiver-sdk.mjs';
import {randomUUID} from 'node:crypto';
import {DEMOS} from '../shared/domain.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import net from 'node:net';
import http from 'node:http';
const SECRET='verified-sandbox-HMAC-secret-for-partner-testing-2026';
const CRED='separate-credential-for-partner-conformance-test';
const record=[];
let app;
function check(name,assertion){record.push({name,passed:!!assertion});if(!assertion)throw new Error('Partner conformance failed: '+name);}
function command(s,o={}){return {commandId:randomUUID(),expectedVersion:s.version,...o};}
try {
 process.env.JUDGE_SANDBOX_PARTNER_KEY=CRED;
 const port=await new Promise((done,reject)=>{const sock=net.createServer();sock.once('error',reject);sock.listen(0,'127.0.0.1',()=>{const port=sock.address().port;sock.close(()=>done(port));});});
 app=createApp({store:new Store(':memory:'),port,host:'127.0.0.1',origin:'http://127.0.0.1:'+port,secret:SECRET,platforms:[{id:'A',name:'Verified sandbox receiver',mode:'deeplink',verified:true,url:'https://partner.example.com/judge/receive',credentialEnv:'JUDGE_SANDBOX_PARTNER_KEY',confirmedEvents:['ad_created']}],});
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+port;
 const fetcher=(url,options={})=>new Promise((resolve,reject)=>{
   const target=new URL(url);
   const req=http.request({hostname:'127.0.0.1',port:target.port,path:target.pathname,method:options.method||'POST',
     headers:{...options.headers,host:target.host}},res=>{
       const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,text:async()=>Buffer.concat(parts).toString('utf8')}));
     });
   req.once('error',err=>{console.error('transport',err.code,err.message);reject(err);});req.end(options.body);
 });
 const receiver=createJudgeReceiver({judgeOrigin:origin,platformId:'A',credential:CRED,allowLoopbackTests:true,fetcher});
 let r=app.svc.create('owner',{claim:DEMOS[0].claim,draft:DEMOS[0]});const id=r.state.id;
 r=app.svc.act('owner',id,command(r.state,{action:'narrow'}));
 r=app.svc.prepare('owner',id,command(r.state,{draft:DEMOS[0]}));
 r=app.svc.verdict('owner',id,command(r.state,{claim:'Создайте рекламный материал для своего малого бизнеса.',acknowledged:true}));
 const h=app.svc.handoff('owner',id,command(r.state,{platformId:'A',consent:true})).handoff;
 check('signed handoff created',h.mode==='deeplink'&&h.url.includes('judge_token='));
 const signed=new URL(h.url).searchParams.get('judge_token');
 const received=await receiver.redeem({token:signed,requestId:'sandbox-request-0001'});
 check('receiver obtained typed brief over authenticated HTTP',received.handoffId===h.id&&typeof received.brief.finalClaim==='string');
 const replay=await receiver.redeem({token:signed,requestId:'sandbox-request-0001'});
 check('same persisted request id returns idempotent duplicate',replay.duplicate===true);
 let conflict=false;
 try{await receiver.redeem({token:signed,requestId:'sandbox-request-0002'});}catch(e){conflict=e.code==='REDEEMED';}
 check('different request id is rejected',conflict);
 const event=await receiver.confirm({handoffId:h.id,eventId:'creative-event-0001',action:'ad_created'});
 check('verified external ad action accepted once',event.ok&&event.duplicate===false);
 const repeated=await receiver.confirm({handoffId:h.id,eventId:'creative-event-0001',action:'ad_created'});
 check('repeated ad action idempotent',repeated.duplicate===true);
 let incompatible=false;
 try{await receiver.confirm({handoffId:h.id,eventId:'creative-event-0002',action:'sale_recorded'});}catch(e){incompatible=e.code==='EVENT_CONTRACT';}
 check('non-contract business event rejected',incompatible);
 let fake=false;
 try{await createJudgeReceiver({judgeOrigin:origin,platformId:'A',credential:'wrong-but-long-enough-credential',allowLoopbackTests:true,fetcher}).confirm({handoffId:h.id,eventId:'creative-event-0003',action:'ad_created'});}catch(e){fake=e.code==='AUTH';}
 check('foreign integration key rejected',fake);
 let tamper=false;
 try{await receiver.redeem({token:signed.slice(0,-8)+'tampered',requestId:'sandbox-request-0003'});}catch(e){tamper=['TOKEN','AUTH'].includes(e.code);}
 check('tampered handoff signature rejected',tamper);
 const summary=app.svc.detail('owner',id);
 check('server case audit consistent after webhook confirmations',summary.audit.consistent);
 check('exactly one useful action recorded',summary.events.filter(e=>e.type==='useful_action').length===1);
 const report={schema:'judge-partner-conformance-1',kind:'loopback sandbox, not an external site',testedPlatform:'A (synthetic)',checks:record,passed:record.filter(x=>x.passed).length,failed:record.filter(x=>!x.passed).length};
 mkdirSync(resolve('reports'),{recursive:true});writeFileSync(resolve('reports/partner-conformance.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,notice:report.kind}));
}catch(e){console.error(e.stack||e.message);process.exitCode=1;}
finally{if(app){await new Promise(resolve=>app.server.close(resolve));app.store.close();}delete process.env.JUDGE_SANDBOX_PARTNER_KEY;}
