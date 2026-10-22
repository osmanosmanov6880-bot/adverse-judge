import test from 'node:test';
import assert from 'node:assert/strict';
import {createJudgeReceiver,JudgePartnerError,validateJudgeOrigin} from '../integrations/receiver-sdk.mjs';
const credential='server-side-secret-credential-example',origin='https://judge.example.org';
const valid=()=>({judgeOrigin:origin,platformId:'A',credential});
const ok=(data)=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
test('receiver rejects insecure and malformed origins',()=>{
 for(const url of ['http://judge.example.org','http://127.0.0.1:3000','https://admin:pass@judge.example.org','https://judge.example.org/any-path','https://127.0.0.1'])assert.throws(()=>validateJudgeOrigin(url),JudgePartnerError);
 assert.equal(validateJudgeOrigin('http://localhost:3000',{allowLoopbackTests:true}),'http://localhost:3000');
 assert.equal(validateJudgeOrigin('https://judge.example.org'),origin);
});
test('receiver sends credentials only to fixed HTTPS origin and pins idempotency key',async()=>{
 const seen=[];const sdk=createJudgeReceiver({...valid(),fetcher:async(url,options)=>{seen.push({url,options});return ok({handoffId:'handoff-uuid',brief:{claim:'test brief'},duplicate:false});}});
 const result=await sdk.redeem({token:'payload.signature',requestId:'receiver-request-unique-111'});
 assert.equal(result.brief.claim,'test brief');assert.equal(seen[0].url,origin+'/api/integrations/redeem');
 assert.equal(seen[0].options.headers.Authorization,'Bearer '+credential);
 assert.equal(seen[0].options.redirect,'manual');
 assert.deepEqual(JSON.parse(seen[0].options.body),{platformId:'A',token:'payload.signature',requestId:'receiver-request-unique-111'});
 await assert.rejects(()=>sdk.redeem({token:'payload.signature',requestId:'123'}),e=>e.code==='INPUT');
});
test('receiver never follows redirect with authorization header',async()=>{
 const sdk=createJudgeReceiver({...valid(),fetcher:async()=>({status:302,ok:false,text:async()=>''})});
 await assert.rejects(()=>sdk.redeem({token:'payload.signature',requestId:'receiver-retry-key-2'}),e=>e.code==='REDIRECT');
});
test('receiver surfaces transient network failure without logging secrets',async()=>{
 const sdk=createJudgeReceiver({...valid(),fetcher:async()=>{throw Error('secret '+credential);}});
 await assert.rejects(()=>sdk.redeem({token:'payload.signature',requestId:'receiver-retry-key-3'}),e=>e.code==='NETWORK'&&!e.message.includes(credential));
});
test('receiver can confirm only validated action and response',async()=>{
 const received=[];const sdk=createJudgeReceiver({...valid(),fetcher:async(url,options)=>{received.push([url,JSON.parse(options.body)]);return ok({ok:true,duplicate:true});}});
 const result=await sdk.confirm({handoffId:'handoff-uuid',eventId:'external-object-123',action:'ad_created'});
 assert.deepEqual(result,{ok:true,duplicate:true});assert.equal(received[0][1].eventId,'external-object-123');
 await assert.rejects(()=>sdk.confirm({handoffId:'handoff-uuid',eventId:'x',action:'ad_created'}),e=>e.code==='INPUT');
});
