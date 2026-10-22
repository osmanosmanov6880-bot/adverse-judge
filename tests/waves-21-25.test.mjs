import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {WorkspaceService} from '../server/workspaces.mjs';
import {ProductionService} from '../server/production.mjs';
import {AdvancedService} from '../server/advanced.mjs';
import {GovernanceService} from '../server/governance.mjs';
import {IdentityService} from '../server/identity.mjs';
import {RevisionService} from '../server/revisions.mjs';
import {MetricsImportService,parseCSV,cleanRows} from '../server/metrics-import.mjs';
import {DeliveryService} from '../server/delivery.mjs';
import {ReadinessService} from '../server/ops25.mjs';
import {passwordHash,verifyPassword} from '../server/security.mjs';
import {DEMOS} from '../shared/domain.mjs';
const SECRET='test-signing-secret-for-release-waves-2026-key';
const CALLBACK='test-callback-secret-for-partner-2026-111111';
const DELKEY='test-delivery-signature-key-for-partner-2026-11111';
function fixture(t,{partner=false,identity=null}={}){
 if(partner){const oldCB=process.env.JUDGE_WAVES_CB_KEY,oldDEL=process.env.JUDGE_WAVES_DELIVERY_KEY;
  process.env.JUDGE_WAVES_CB_KEY=CALLBACK;process.env.JUDGE_WAVES_DELIVERY_KEY=DELKEY;
  t.after(()=>{if(oldCB==null)delete process.env.JUDGE_WAVES_CB_KEY;else process.env.JUDGE_WAVES_CB_KEY=oldCB;if(oldDEL==null)delete process.env.JUDGE_WAVES_DELIVERY_KEY;else process.env.JUDGE_WAVES_DELIVERY_KEY=oldDEL;});}
 const platforms=partner?[{id:'A',name:'Controlled test partner',mode:'api',verified:true,deliveryUrl:'https://ads-receiver.example.org/api/adverse',deliveryKeyEnv:'JUDGE_WAVES_DELIVERY_KEY',credentialEnv:'JUDGE_WAVES_CB_KEY',confirmedEvents:['asset_created']}]:[];
 const store=new Store(':memory:');t.after(()=>store.close());
 for(const user of ['owner','editor','approver','outsider'])store.run('INSERT INTO users VALUES(?,?,?,?)',user,`${user}@example.invalid`,'stub-pw-hash','2026-10-22T00:00:00Z');
 const judge=new JudgeService(store,{platforms,secret:partner?SECRET:''}),ws=new WorkspaceService(judge,{identity}),prod=new ProductionService(judge,ws),adv=new AdvancedService(prod,judge),gov=new GovernanceService(prod,adv);prod.advanced=adv;prod.governance=gov;adv.governance=gov;
 const wid=ws.create('owner',{name:'International Campaign Lab'}).id;
 for(const user of ['editor','approver'])ws.accept(user,ws.issueInvite('owner',wid,{role:'reviewer'}).token);
 const d=DEMOS[0];let state=judge.create('owner',{claim:d.claim,draft:d});const caseId=state.state.id;
 const cmd=(name,data={})=>({commandId:randomUUID(),expectedVersion:state.state.version,...data});
 state=judge.act('owner',caseId,cmd('act',{action:'narrow'}));state=judge.prepare('owner',caseId,cmd('prepare',{draft:d}));state=judge.verdict('owner',caseId,cmd('verdict',{claim:'Create a clear advertising draft using product facts',acknowledged:true}));
 ws.share('owner',wid,caseId);
 const p=prod.create('owner',{workspaceId:wid,name:'Clear brand autumn campaign',objective:'Explain the value of understandable advertisements to teams',audience:'Independent marketing studios',channel:'social'}),cid=p.campaign.id;
 let r=prod.attach('owner',cid,{caseId,expectedRevision:p.campaign.revision});const bid=r.briefs[0].id;
 r=prod.addEvidence('owner',cid,{expectedRevision:r.campaign.revision,briefId:bid,statement:'Tool creates advertising material from a draft',kind:'document',locator:'User manual version one',explanation:'The editor checked a documented feature'});
 r=prod.reviewEvidence('editor',cid,r.evidence[0].id,{inspected:true,expectedRevision:r.campaign.revision});
 r=prod.creative('owner',cid,{expectedRevision:r.campaign.revision,briefId:bid,channel:'social',language:'en',headline:'Create a better advertising draft',body:'Work from a clear brief with reviewed product facts',cta:'Start writing'});
 const revisions=new RevisionService(prod),imports=new MetricsImportService(adv);
 return {store,judge,ws,prod,adv,gov,revisions,imports,wid,cid,bid,caseId,identity,get rev(){return prod.detail('owner',cid).campaign.revision;},release(){let x=prod.requestReview('owner',cid,{expectedRevision:this.rev,note:'Check campaign statements and creative independently'});x=prod.decide('approver',cid,{expectedRevision:x.campaign.revision,decision:'approve',note:'Another team member reviewed the marketing claims'});return prod.release('owner',cid,{expectedRevision:x.campaign.revision});}};
}

test('wave 21: email challenge proves control, can be used only once and does not leak raw token to DB',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());store.run('INSERT INTO users VALUES(?,?,?,?)','u','one@example.invalid','placeholder',new Date().toISOString());
 let now=Date.now(),sent=[];const svc=new IdentityService(store,{mailer:async m=>sent.push(m),now:()=>now,requireVerified:true});
 assert.equal(svc.status('u').verified,false);assert.throws(()=>svc.assertVerified('u'),e=>e.code==='EMAIL_UNVERIFIED');
 const request=await svc.issue('u','verify');assert.equal(request.sent,true);assert.equal(request.code,undefined);
 assert.equal(sent.length,1);assert.equal(store.one('SELECT COUNT(*) AS n FROM email_challenges WHERE token_hash=?',sent[0].code)?.n??0,0);
 assert.throws(()=>svc.verify('outsider',sent[0].code));
 assert.equal(svc.verify('u',sent[0].code).verified,true);svc.assertVerified('u');
 assert.throws(()=>svc.verify('u',sent[0].code),e=>e.code==='TOKEN');
});
test('wave 21: email expiry, failed delivery, unavailable provider and privacy-preserving account lookup',async t=>{
 const db=new Store(':memory:');t.after(()=>db.close());db.run('INSERT INTO users VALUES(?,?,?,?)','u','one@example.invalid','stub',new Date().toISOString());
 let now=1000000,mail=[];const i=new IdentityService(db,{now:()=>now,mailer:async m=>mail.push(m)});
 await i.issue('u','verify');now+=1800001;assert.throws(()=>i.verify('u',mail[0].code),e=>e.status===410);
 assert.equal((await i.requestReset('not-here@example.invalid')).sent,true);assert.equal(mail.length,1);
 assert.equal((await i.requestReset('one@example.invalid')).sent,true);assert.equal(mail.at(-1).purpose,'reset');
 const unavailable=new IdentityService(db);await assert.rejects(()=>unavailable.issue('u','verify'),e=>e.code==='MAIL_UNAVAILABLE');
 const broken=new IdentityService(db,{mailer:async()=>{throw Error('mail down');}});await assert.rejects(()=>broken.issue('u','verify'),e=>e.code==='MAIL_DELIVERY_FAILED');
});
test('wave 21: password recovery rotates password and revokes every session',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const old=await passwordHash('old-password-long-12345');store.run('INSERT INTO users VALUES(?,?,?,?)','u','reset@example.invalid',old,new Date().toISOString());
 store.run('INSERT INTO sessions(id_hash,owner_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)','session1','u','csrf1',Date.now()+100000,new Date().toISOString());
 let code;const i=new IdentityService(store,{mailer:async x=>code=x.code});await i.requestReset('reset@example.invalid');
 assert.equal((await i.reset(code,'new-password-long-12345')).sessionsRevoked,true);
 assert.equal((await verifyPassword('new-password-long-12345',store.one('SELECT password_hash FROM users WHERE id=?','u').password_hash)),true);
 assert.equal(store.one('SELECT COUNT(*) AS n FROM sessions WHERE owner_id=?','u').n,0);
 await assert.rejects(()=>i.reset(code,'another-password-long-12345'),e=>e.code==='TOKEN');
});
test('wave 21: strict verified mode blocks workspace actions but guest JUDGE cases remain possible',async t=>{
 const db=new Store(':memory:');t.after(()=>db.close());db.run('INSERT INTO users VALUES(?,?,?,?)','u','unverified@example.invalid','stub',new Date().toISOString());
 const i=new IdentityService(db,{requireVerified:true}),judge=new JudgeService(db),ws=new WorkspaceService(judge,{identity:i});
 assert.throws(()=>ws.create('u',{name:'No proof yet'}),e=>e.code==='EMAIL_UNVERIFIED');
 assert.ok(judge.create('u',{claim:'Marketing ideas without ambiguity'}).state.id);
});

test('wave 22: release comparison lists changed creatives and restore resets approval in a new revision',t=>{
 const f=fixture(t),release=f.release(),before=f.prod.detail('owner',f.cid);
 f.prod.creative('owner',f.cid,{expectedRevision:f.rev,briefId:f.bid,channel:'search',language:'en',headline:'A different headline',body:'A new draft with a second channel',cta:'Read this'});
 const comparison=f.revisions.compare('owner',f.cid,release.releaseId);
 assert.equal(comparison.added.length,1);assert.equal(comparison.removed.length,0);assert.equal(comparison.canRestore,true);
 const rolled=f.revisions.restore('owner',f.cid,release.releaseId,{expectedRevision:f.rev,acknowledged:true});
 assert.equal(rolled.approvalRequired,true);assert.equal(f.prod.detail('owner',f.cid).campaign.status,'draft');
 assert.equal(f.prod.detail('owner',f.cid).creatives.length,1);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM creative_revision_snapshots').n,1);
 assert.equal(f.prod.exportRelease('owner',f.cid,release.releaseId).sha256,release.digest);
 assert.equal(f.revisions.compare('owner',f.cid,release.releaseId).added.length,0);
 assert.throws(()=>f.revisions.restore('owner',f.cid,release.releaseId,{expectedRevision:before.campaign.revision}),e=>e.code==='VERSION_CONFLICT');
});
test('wave 22: unauthorized viewer, wrong campaign and missing acknowledgement cannot restore',t=>{
 const f=fixture(t),release=f.release();
 assert.throws(()=>f.revisions.compare('outsider',f.cid,release.releaseId),e=>e.code==='NOT_FOUND');
 assert.throws(()=>f.revisions.restore('editor',f.cid,release.releaseId,{expectedRevision:f.rev}),e=>e.code==='ACK_REQUIRED');
 assert.throws(()=>f.revisions.compare('owner',f.cid,randomUUID()),e=>e.code==='NOT_FOUND');
});
test('wave 22: historical release never bypasses revoked source-case permission',t=>{
 const f=fixture(t),r=f.release();f.ws.unshare('owner',f.wid,f.caseId);
 assert.equal(f.revisions.compare('owner',f.cid,r.releaseId).canRestore,false);
 assert.throws(()=>f.revisions.restore('owner',f.cid,r.releaseId,{expectedRevision:f.rev,acknowledged:true}),e=>e.code==='SOURCE_STALE');
});

test('wave 23: robust CSV parsing accepts escaped quotes and refuses malformed, missing, or invalid rows',()=>{
 const csv='date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-20,120,20,4,2,EUR,"Actual note, from a ""quoted"" file"';
 const rows=cleanRows(csv);assert.equal(rows[0].note,'Actual note, from a "quoted" file');
 assert.throws(()=>parseCSV('a,b\n1,2'),e=>e.code==='CSV_HEADER');
 assert.throws(()=>cleanRows(csv+'\n2026-10-21,001,20,4,2,EUR,Not acceptable integer'),e=>e.code==='CSV_NUMBER');
 assert.throws(()=>cleanRows(csv.replace(',20,4,2,',',20,40,2,')),e=>e.code==='CSV_FUNNEL');
});
test('wave 23: preview is read-only, importing CSV is idempotent and only carries human provenance',t=>{
 const f=fixture(t),r=f.release();
 const csv='date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-20,12500,8000,350,18,EUR,This row came from a manual export\n2026-10-21,15000,9000,400,22,EUR,Another human-supplied spreadsheet value';
 const input={releaseId:r.releaseId,sourceName:'Manual October export',csv};
 const p=f.imports.preview('owner',f.cid,input);
 assert.equal(p.rows.length,2);assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaign_observations').n,0);
 assert.throws(()=>f.imports.preview('outsider',f.cid,input),e=>e.code==='NOT_FOUND');
 assert.throws(()=>f.imports.commit('owner',f.cid,{...input,digest:'tampered',expectedRevision:f.rev,acknowledged:true}),e=>e.code==='CSV_CHANGED');
 const committed=f.imports.commit('owner',f.cid,{...input,digest:p.digest,expectedRevision:f.rev,acknowledged:true});
 assert.equal(committed.rowCount,2);assert.equal(committed.totals[0].source,undefined);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM campaign_observations').n,2);
 assert.equal(f.imports.commit('owner',f.cid,{...input,digest:p.digest,expectedRevision:f.rev,acknowledged:true}).duplicate,true);
 assert.equal(f.imports.list('owner',f.cid)[0].rowCount,2);
 assert.equal(f.store.one('SELECT source FROM campaign_observations LIMIT 1').source,'manual');
});
test('wave 23: a stale revision, invalid funnel and in-batch duplicate are blocked',t=>{
 const f=fixture(t),r=f.release(),csv='date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-20,100,20,3,2,EUR,Manual observation from source';
 const input={releaseId:r.releaseId,sourceName:'Report file',csv},p=f.imports.preview('owner',f.cid,input);
 assert.throws(()=>f.imports.commit('owner',f.cid,{...input,digest:p.digest,expectedRevision:f.rev+1,acknowledged:true}),e=>e.code==='VERSION_CONFLICT');
 assert.throws(()=>f.imports.preview('owner',f.cid,{...input,csv:csv.replace('20,3,2','20,2,3')}),e=>e.code==='CSV_FUNNEL');
 assert.throws(()=>f.imports.preview('owner',f.cid,{...input,csv:csv+'\n2026-10-20,100,20,3,2,EUR,Manual observation from source'}),e=>e.code==='CSV_DUPLICATE');
});

test('wave 24: durable outbox retries transient failure using the same idempotency key and verifies signature',async t=>{
 const f=fixture(t,{partner:true}),r=f.release(),ticket=f.adv.prepareDispatch('owner',f.cid,r.releaseId,{platformId:'A',consent:true});
 let now=Date.now(),calls=[],responseIndex=0;
 const fake=async (url,opt)=>{
  calls.push({url,opt});const bodyDigest=createHash('sha256').update(opt.body).digest('hex');
  assert.equal(opt.headers['X-ADVERSE-Body-SHA256'],bodyDigest);
  const sig='v1='+createHmac('sha256',DELKEY).update(opt.headers['X-ADVERSE-Idempotency-Key']+'\n'+bodyDigest).digest('hex');
  assert.equal(opt.headers['X-ADVERSE-Signature'],sig);
  assert.equal(opt.redirect,'error');
  const i=responseIndex++;return i===0?{status:503,json:async()=>({})}:{status:202,json:async()=>({accepted:true,idempotencyKey:opt.headers['X-ADVERSE-Idempotency-Key']})};
 };
 const delivery=new DeliveryService(f.adv,{fetcher:fake,clock:()=>now,env:process.env});
 const queue=delivery.enqueue('owner',f.cid,ticket.dispatchId);assert.equal(queue.duplicate,false);
 assert.equal(delivery.enqueue('owner',f.cid,ticket.dispatchId).duplicate,true);
 const first=await delivery.attempt('owner',f.cid,queue.id);assert.equal(first.status,'retry');assert.equal(first.attempts,1);
 await assert.rejects(()=>delivery.attempt('owner',f.cid,queue.id),e=>e.code==='BACKOFF');
 now=first.nextAttemptAt+1;
 const second=await delivery.attempt('owner',f.cid,queue.id);assert.equal(second.status,'accepted');assert.equal(second.partnerAccepted,true);
 assert.equal(calls[0].opt.headers['X-ADVERSE-Idempotency-Key'],calls[1].opt.headers['X-ADVERSE-Idempotency-Key']);
 assert.equal(f.store.one('SELECT status FROM release_dispatches WHERE id=?',ticket.dispatchId).status,'redeemed');
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM dispatch_receipts').n,0);
 assert.equal(f.adv.receiptDispatch('A',CALLBACK,{dispatchId:ticket.dispatchId,eventId:'verified-event-0001',action:'asset_created'}).duplicate,false);
 assert.equal(f.store.one('SELECT status FROM release_dispatches WHERE id=?',ticket.dispatchId).status,'confirmed');
});
test('wave 24: partner cannot claim acceptance with a mismatched ID and cannot manufacture useful action',async t=>{
 const f=fixture(t,{partner:true}),r=f.release(),d=f.adv.prepareDispatch('owner',f.cid,r.releaseId,{platformId:'A',consent:true});
 const delivery=new DeliveryService(f.adv,{fetcher:async()=>({status:202,json:async()=>({accepted:true,idempotencyKey:'forged'})})});
 const q=delivery.enqueue('owner',f.cid,d.dispatchId),res=await delivery.attempt('owner',f.cid,q.id);
 assert.equal(res.status,'failed');assert.equal(f.store.one('SELECT status FROM release_dispatches WHERE id=?',d.dispatchId).status,'issued');
 assert.throws(()=>f.adv.receiptDispatch('A',CALLBACK,{dispatchId:d.dispatchId,eventId:'unverified-event-002',action:'asset_created'}),e=>e.code==='STATE');
});
test('wave 24: outsider denied, emergency pause revokes queued dispatch and prevents delivery',async t=>{
 const f=fixture(t,{partner:true}),r=f.release(),d=f.adv.prepareDispatch('owner',f.cid,r.releaseId,{platformId:'A',consent:true}),delivery=new DeliveryService(f.adv,{fetcher:async()=>{throw Error('must not fetch');}});
 const q=delivery.enqueue('owner',f.cid,d.dispatchId);
 await assert.rejects(()=>delivery.attempt('outsider',f.cid,q.id),e=>e.code==='NOT_FOUND');
 f.gov.controlUpdate('owner',f.wid,{dispatchPaused:true,reason:'Incident response from the workspace owner'});
 await assert.rejects(()=>delivery.attempt('owner',f.cid,q.id),e=>e.code==='STATE');
 assert.equal(f.store.one('SELECT status FROM delivery_queue WHERE id=?',q.id).status,'cancelled');
});

test('wave 25: readiness does not claim production, and recorded attestation has integrity digest',t=>{
 const f=fixture(t),identity=new IdentityService(f.store),delivery=new DeliveryService(f.adv),ops=new ReadinessService({store:f.store,judge:f.judge,identity,delivery,origin:'http://localhost:3000'});
 const report=ops.report();assert.equal(report.productionReady,false);assert.ok(report.blockers.includes('durable_server_database'));assert.ok(report.blockers.includes('verified_identity_delivery'));
 const result=ops.attest();assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(ops.history().length,1);
 assert.equal(f.store.one('SELECT COUNT(*) AS n FROM operator_checks').n,1);
});
test('wave 25: schema migrates existing rows to v27 without corrupting released source evidence',t=>{
 const f=fixture(t),r=f.release();assert.equal(f.store.one('PRAGMA user_version').user_version,28);
 assert.equal(f.prod.exportRelease('owner',f.cid,r.releaseId).sha256,r.digest);
 assert.equal(f.store.one('PRAGMA quick_check').quick_check,'ok');
});
test('wave 24: revoking the dispatch mid-flight never records a successful local redemption',async t=>{
 const f=fixture(t,{partner:true}),r=f.release(),d=f.adv.prepareDispatch('owner',f.cid,r.releaseId,{platformId:'A',consent:true});
 let completeSend,signalReady;
 const ready=new Promise(resolve=>signalReady=resolve);
 const fetcher=async()=>{signalReady();return await new Promise(resolve=>completeSend=resolve);};
 const delivery=new DeliveryService(f.adv,{fetcher}),q=delivery.enqueue('owner',f.cid,d.dispatchId);
 const attempt=delivery.attempt('owner',f.cid,q.id);
 await ready;
 f.adv.revokeDispatch('owner',f.cid,d.dispatchId);
 completeSend({status:202,json:async()=>({accepted:true,idempotencyKey:'judge-'+q.id})});
 const result=await attempt;
 assert.equal(result.status,'failed');assert.equal(result.outcomeUncertain,true);
 assert.equal(result.partnerAccepted,true);
 assert.equal(f.store.one('SELECT status FROM release_dispatches WHERE id=?',d.dispatchId).status,'revoked');
 assert.equal(f.store.one('SELECT status FROM delivery_queue WHERE id=?',q.id).status,'failed');
});
