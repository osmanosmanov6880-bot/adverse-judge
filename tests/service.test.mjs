import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {DEMOS,replay} from '../shared/domain.mjs';
import {hash,passwordHash,verifyPassword,signPayload,verifyPayload,Limiter} from '../server/security.mjs';
function fixture(t,options={}){const store=new Store(':memory:');t.after(()=>store.close());const svc=new JudgeService(store,{platforms:[{id:'A',mode:'clipboard',verified:false}],...options});return {store,svc};}
function cmd(s,rest={}){return {commandId:randomUUID(),expectedVersion:s.version,...rest};}
function finished(svc,owner='owner'){
 let r=svc.create(owner,{claim:DEMOS[0].claim,draft:DEMOS[0]});
 r=svc.act(owner,r.state.id,cmd(r.state,{action:'narrow'}));
 r=svc.prepare(owner,r.state.id,cmd(r.state,{draft:DEMOS[0]}));
 return svc.verdict(owner,r.state.id,cmd(r.state,{claim:r.state.candidates[0].text,acknowledged:true}));
}
test('owner cannot read another owner case',t=>{const {svc}=fixture(t);const r=finished(svc);assert.throws(()=>svc.detail('stranger',r.state.id),x=>x.code==='NOT_FOUND');assert.equal(svc.list('stranger').length,0);});
test('owner cannot mutate another owner case',t=>{const {svc}=fixture(t);const r=finished(svc);assert.throws(()=>svc.invite('stranger',r.state.id,cmd(r.state,{consent:true})),x=>x.code==='NOT_FOUND');});
test('state survives actual sqlite file close and reopen',()=>{const dir=mkdtempSync(join(tmpdir(),'judge-'));let store;try{store=new Store(join(dir,'db.sqlite'));const svc=new JudgeService(store),r=finished(svc);store.close();store=new Store(join(dir,'db.sqlite'));const second=new JudgeService(store);assert.deepEqual(second.detail('owner',r.state.id).state,r.state);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}});
test('replay of persisted events matches snapshot',t=>{const {svc}=fixture(t),r=finished(svc);assert.deepEqual(replay(r.events),r.state);});
test('invalid verdict rolls back both events',t=>{const {svc}=fixture(t),r=svc.create('owner',{claim:'Initial claim'});const before=svc.eventRows(r.state.id);assert.throws(()=>svc.verdict('owner',r.state.id,cmd(r.state,{claim:'Final claim',acknowledged:true})));assert.deepEqual(svc.eventRows(r.state.id),before);});
test('stale version fails without mutating',t=>{const {svc}=fixture(t),r=finished(svc);assert.throws(()=>svc.invite('owner',r.state.id,{...cmd(r.state,{consent:true}),expectedVersion:1}),x=>x.code==='VERSION_CONFLICT');assert.equal(svc.own('owner',r.state.id).version,r.state.version);});
test('repeated command does not add another event',t=>{const {svc}=fixture(t),r=svc.create('owner',{claim:'Initial claim'}),body=cmd(r.state,{action:'narrow'});svc.act('owner',r.state.id,body);const out=svc.act('owner',r.state.id,body);assert.equal(out.duplicate,true);assert.equal(out.events.length,2);});
test('witness consent required',t=>{const {svc}=fixture(t),r=finished(svc);assert.throws(()=>svc.invite('owner',r.state.id,cmd(r.state)),x=>x.code==='CONSENT');});
test('invite token is only stored as hash',t=>{const {svc,store}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));const row=store.one('SELECT * FROM invites');assert.equal(row.token_hash,hash(out.invite.token));assert.ok(!JSON.stringify(svc.detail('owner',r.state.id)).includes(out.invite.token));});
test('public invite discloses final claim and audience only',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));const p=svc.publicInvite(out.invite.token);assert.deepEqual(Object.keys(p).sort(),['audience','claim','disclosure','expiresAt']);assert.equal(p.claim,r.state.finalClaim);});
test('author cannot act as own witness',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));assert.throws(()=>svc.object('owner',out.invite.token,{text:'This is a relevant objection.'}),x=>x.code==='SELF_WITNESS');});
test('real witness reopens case and cannot submit twice',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));svc.object('friend',out.invite.token,{text:'This is a relevant objection.'});const result=svc.detail('owner',r.state.id);assert.equal(result.state.phase,'reopened');assert.equal(result.state.objections.length,1);assert.equal(result.events.at(-1).type,'case_reopened');assert.throws(()=>svc.object('friend',out.invite.token,{text:'This is another objection.'}),x=>x.code==='USED');});
test('revoked invite fails closed',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));svc.revoke('owner',r.state.id,cmd(out.state,{inviteId:out.invite.id}));assert.throws(()=>svc.publicInvite(out.invite.token),x=>x.code==='EXPIRED');});
test('expired invite fails closed',t=>{let now=Date.now();const {svc}=fixture(t,{clock:()=>now}),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));now+=8*86400000;assert.throws(()=>svc.publicInvite(out.invite.token),x=>x.code==='EXPIRED');});
test('new verdict invalidates outstanding old invites',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));svc.object('friend',out.invite.token,{text:'This is a relevant objection.'});let d=svc.detail('owner',r.state.id);d=svc.defend('owner',d.state.id,cmd(d.state,{text:'Here is a reasoned response.'}));const old=svc.invite('owner',d.state.id,cmd(d.state,{consent:true}));let q=svc.invite('owner',d.state.id,cmd(old.state,{consent:true}));svc.object('second_friend',q.invite.token,{text:'Another substantive objection.'});q=svc.detail('owner',d.state.id);q=svc.act('owner',d.state.id,cmd(q.state,{action:'narrow'}));q=svc.prepare('owner',d.state.id,cmd(q.state,{draft:DEMOS[0]}));svc.verdict('owner',d.state.id,cmd(q.state,{claim:'A newly revised claim.',acknowledged:true}));assert.throws(()=>svc.publicInvite(old.invite.token),x=>x.code==='EXPIRED');});
test('clipboard does not count as a useful platform action',t=>{const {svc}=fixture(t),r=finished(svc),out=svc.handoff('owner',r.state.id,cmd(r.state,{platformId:'A'}));assert.equal(out.handoff.mode,'clipboard');assert.equal(out.handoff.deliveryConfirmed,false);assert.equal(svc.stats('owner').useful_action,undefined);});
test('unconfigured API does not fake success',t=>{const {svc}=fixture(t,{platforms:[{id:'A',mode:'api',verified:false}]}),r=finished(svc);assert.throws(()=>svc.handoff('owner',r.state.id,cmd(r.state,{platformId:'A'})),x=>x.code==='NOT_CONFIGURED');});
test('signed handoff can be redeemed once and receipt is idempotent',t=>{
 process.env.JUDGE_TEST_INTEGRATION='test-credential-not-for-production';t.after(()=>delete process.env.JUDGE_TEST_INTEGRATION);
 const {svc}=fixture(t,{secret:'a-test-secret-of-at-least-32-characters',platforms:[{id:'A',mode:'deeplink',verified:true,url:'https://example.com/receive',credentialEnv:'JUDGE_TEST_INTEGRATION',confirmedEvents:['ad_created']}]}),r=finished(svc);
 const out=svc.handoff('owner',r.state.id,cmd(r.state,{platformId:'A',consent:true}));const token=new URL(out.handoff.url).searchParams.get('judge_token');
 const decoded=Buffer.from(token.split('.')[0],'base64url').toString();assert.ok(!decoded.includes(r.state.claim));
 assert.throws(()=>svc.redeem('A','wrong',token),x=>x.code==='AUTH');
 const receipt=svc.redeem('A',process.env.JUDGE_TEST_INTEGRATION,token);assert.equal(receipt.brief.finalClaim,r.state.finalClaim);
 assert.throws(()=>svc.redeem('A',process.env.JUDGE_TEST_INTEGRATION,token),x=>x.code==='REDEEMED');
 const body={eventId:'external-event-001',handoffId:out.handoff.id,action:'ad_created'};
 assert.equal(svc.receipt('A',process.env.JUDGE_TEST_INTEGRATION,body).duplicate,false);
 assert.equal(svc.receipt('A',process.env.JUDGE_TEST_INTEGRATION,body).duplicate,true);
 assert.equal(svc.stats('owner').useful_action,1);
});
test('deletion cascades events and invites',t=>{const {svc,store}=fixture(t),r=finished(svc);svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));svc.deleteCase('owner',r.state.id);assert.equal(store.one('SELECT COUNT(*) n FROM events').n,0);assert.equal(store.one('SELECT COUNT(*) n FROM invites').n,0);});
test('personal export does not expose password/session/token hashes',t=>{const {svc}=fixture(t),r=finished(svc);svc.invite('owner',r.state.id,cmd(r.state,{consent:true}));const json=JSON.stringify(svc.export('owner'));assert.ok(!json.includes('token_hash'));assert.ok(!json.includes('password_hash'));assert.ok(json.includes('judge-personal-export-2'));});
test('scrypt hashes verify; invalid passwords fail',async()=>{const h=await passwordHash('this-is-a-long-local-test');assert.ok(await verifyPassword('this-is-a-long-local-test',h));assert.equal(await verifyPassword('wrong',h),false);assert.equal(await verifyPassword('wrong',null),false);await assert.rejects(()=>passwordHash('short'));});
test('signed payload rejects tampering and expiry',()=>{const secret='test-secret-with-more-than-32-characters',p=signPayload({v:1,exp:1000,id:'x'},secret);assert.equal(verifyPayload(p,secret,999).id,'x');assert.throws(()=>verifyPayload(p+'x',secret,999));assert.throws(()=>verifyPayload(p,secret,1001));});
test('rate limiting recovers at window boundary',()=>{let now=1000;const l=new Limiter(()=>now);l.check('a',2,100);l.check('a',2,100);assert.throws(()=>l.check('a',2,100),x=>x.code==='RATE_LIMIT');now=1100;assert.doesNotThrow(()=>l.check('a',2,100));});
test('platform remains unconfigured without receiver credentials',t=>{
 const {svc}=fixture(t,{secret:'a-secret-with-at-least-32-characters',platforms:[{id:'A',mode:'deeplink',verified:true,url:'https://example.com/receive',credentialEnv:'UNCONFIGURED_JUDGE_TEST_KEY'}]});
 assert.equal(svc.platformList()[0].configured,false);
});
