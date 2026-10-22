import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {WorkspaceService} from '../server/workspaces.mjs';
import {ProductionService} from '../server/production.mjs';
import {AdvancedService} from '../server/advanced.mjs';
import {GovernanceService} from '../server/governance.mjs';
import {DEMOS} from '../shared/domain.mjs';
const PARTNER='test-partner-credential-2026-1234567890';
const SECRET='test-handoff-signing-key-2026-1234567890123456';
function fixture(t,{partner=false}={}){
 const prev=process.env.JUDGE_GOV_TEST_KEY;
 if(partner){process.env.JUDGE_GOV_TEST_KEY=PARTNER;t.after(()=>{if(prev===undefined)delete process.env.JUDGE_GOV_TEST_KEY;else process.env.JUDGE_GOV_TEST_KEY=prev;});}
 const db=new Store(':memory:');t.after(()=>db.close());
 for(const u of ['owner','editor','approver','viewer','outsider'])db.run('INSERT INTO users VALUES(?,?,?,?)',u,u+'@example.test','fake','2026-10-22T00:00:00Z');
 const platforms=partner?[{id:'A',name:'QA partner',mode:'deeplink',verified:true,url:'https://partner.qa.invalid/receive',credentialEnv:'JUDGE_GOV_TEST_KEY',confirmedEvents:['asset_created']}]:[];
 const judge=new JudgeService(db,{platforms,secret:partner?SECRET:''});
 const ws=new WorkspaceService(judge),prod=new ProductionService(judge,ws),adv=new AdvancedService(prod,judge),gov=new GovernanceService(prod,adv);
 prod.advanced=adv;prod.governance=gov;adv.governance=gov;
 const wid=ws.create('owner',{name:'Governance workspace'}).id;
 for(const [user,role] of [['editor','reviewer'],['approver','reviewer'],['viewer','viewer']])ws.accept(user,ws.issueInvite('owner',wid,{role}).token);
 const d=DEMOS[0];let r=judge.create('owner',{claim:d.claim,draft:d});const caseId=r.state.id;
 const cmd=extra=>({commandId:randomUUID(),expectedVersion:r.state.version,...extra});
 r=judge.act('owner',caseId,cmd({action:'narrow'}));r=judge.prepare('owner',caseId,cmd({draft:d}));r=judge.verdict('owner',caseId,cmd({claim:'Create advertising material using actual facts',acknowledged:true}));
 ws.share('owner',wid,caseId);
 const start=prod.create('owner',{workspaceId:wid,name:'October governance test',objective:'Explain advertising editing to small teams',audience:'Small agencies',channel:'social'});
 const cid=start.campaign.id;
 let x=prod.attach('owner',cid,{caseId,expectedRevision:start.campaign.revision});const bid=x.briefs[0].id;
 x=prod.addEvidence('owner',cid,{briefId:bid,statement:'JUDGE provides a structured text review',kind:'document',locator:'internal-guide-v1-2026',explanation:'Compare the text with our up-to-date product guide',expectedRevision:x.campaign.revision});const eid=x.evidence[0].id;
 x=prod.reviewEvidence('editor',cid,eid,{inspected:true,expectedRevision:x.campaign.revision});
 x=prod.creative('owner',cid,{briefId:bid,channel:'social',language:'en',headline:'Review a clear message',body:'Prepare campaign copy with a clear process',cta:'Get started',expectedRevision:x.campaign.revision});const creativeId=x.creatives[0].id;
 return {db,judge,ws,prod,adv,gov,wid,cid,bid,eid,creativeId,caseId,get rev(){return prod.detail('owner',cid).campaign.revision;}};
}
function approved(f){let r=f.prod.requestReview('owner',f.cid,{expectedRevision:f.rev,note:'Please check this copy and human-reviewed sources.'});
 r=f.prod.decide('approver',f.cid,{expectedRevision:r.campaign.revision,decision:'approve',note:'An independent editor checked the campaign materials.'});return f.prod.release('owner',f.cid,{expectedRevision:r.campaign.revision});}
const errorCode=(code)=>e=>e?.code===code;
test('wave16: strict claim trace is owner-controlled, versioned and scoped to the source brief',t=>{
 const f=fixture(t),g=f.gov;
 assert.equal(g.detail('viewer',f.cid).requireMapping,false);
 assert.throws(()=>g.policy('editor',f.cid,{expectedRevision:f.rev,requireMapping:true}),errorCode('FORBIDDEN'));
 g.policy('owner',f.cid,{expectedRevision:f.rev,requireMapping:true});
 assert.ok(f.prod.preflight('owner',f.cid).reasons.some(x=>x.startsWith('UNTRACED_CREATIVE')));
 assert.throws(()=>approved(f),errorCode('PREFLIGHT'));
 assert.throws(()=>g.bind('viewer',f.cid,{expectedRevision:f.rev,creativeId:f.creativeId,evidenceId:f.eid}),errorCode('FORBIDDEN'));
 const before=f.rev;g.bind('owner',f.cid,{expectedRevision:f.rev,creativeId:f.creativeId,evidenceId:f.eid});
 assert.equal(f.rev,before+1);assert.equal(g.detail('owner',f.cid).traces[0].valid,true);
 assert.equal(f.prod.preflight('owner',f.cid).ready,true);
 assert.throws(()=>g.bind('owner',f.cid,{expectedRevision:before,creativeId:f.creativeId,evidenceId:f.eid}),errorCode('VERSION_CONFLICT'));
});
test('wave16: links cannot reference another brief or stale evidence; invalidation is dynamic',t=>{
 const f=fixture(t);f.gov.policy('owner',f.cid,{expectedRevision:f.rev,requireMapping:true});
 const b2=f.judge.create('owner',{claim:'Another clear campaign example',draft:DEMOS[1]});
 // Another campaign cannot be used to attach evidence to the first creative.
 const start=f.prod.create('owner',{workspaceId:f.wid,name:'Another initiative',objective:'Separate source documentation for product facts',audience:'Editors',channel:'social'});
 assert.throws(()=>f.gov.bind('owner',f.cid,{expectedRevision:f.rev,creativeId:f.creativeId,evidenceId:randomUUID()}),errorCode('TRACE_SCOPE'));
 f.gov.bind('owner',f.cid,{expectedRevision:f.rev,creativeId:f.creativeId,evidenceId:f.eid});
 f.ws.removeMember('owner',f.wid,'editor');
 assert.ok(f.prod.preflight('owner',f.cid).reasons.some(x=>x.startsWith('UNREVIEWED_EVIDENCE')));
 assert.ok(f.prod.preflight('owner',f.cid).reasons.some(x=>x.startsWith('UNTRACED_CREATIVE')));
});
test('wave17: critical risk blocks approval and requires independent resolution',t=>{
 const f=fixture(t);f.gov.issueCreate('owner',f.cid,{expectedRevision:f.rev,title:'Unsubstantiated guarantee',details:'This text may imply a factual guarantee that was not evidenced.',severity:'critical'});
 assert.ok(f.gov.gate(f.cid).some(x=>x.startsWith('OPEN_CRITICAL_ISSUES')));
 assert.throws(()=>approved(f),errorCode('PREFLIGHT'));
 const risk=f.gov.detail('owner',f.cid).issues[0];
 assert.throws(()=>f.gov.issueResolve('owner',f.cid,risk.id,{expectedRevision:f.rev,note:'I checked this statement and everything is fine.'}),errorCode('SEPARATION_OF_DUTIES'));
 assert.throws(()=>f.gov.issueResolve('viewer',f.cid,risk.id,{expectedRevision:f.rev,note:'I checked this statement and everything is fine.'}),errorCode('FORBIDDEN'));
 f.gov.issueResolve('editor',f.cid,risk.id,{expectedRevision:f.rev,note:'We replaced the unsupported claim with a limited scope statement.'});
 assert.equal(f.gov.detail('owner',f.cid).issues[0].status,'resolved');
 assert.equal(f.prod.preflight('owner',f.cid).ready,true);
 const rel=approved(f);assert.match(rel.digest,/^[0-9a-f]{64}$/);
});
test('wave17: issues opened after approval invalidate editorial approval',t=>{
 const f=fixture(t),rel=approved(f);
 assert.equal(f.prod.detail('owner',f.cid).campaign.status,'approved');
 f.gov.issueCreate('editor',f.cid,{expectedRevision:f.rev,title:'Potential overclaim',details:'A reviewer has found an unsupported interpretation in the copy.',severity:'critical'});
 assert.equal(f.prod.detail('owner',f.cid).campaign.status,'draft');
 assert.throws(()=>f.prod.release('owner',f.cid,{expectedRevision:f.rev}),errorCode('STATE'));
 assert.equal(f.prod.exportRelease('owner',f.cid,rel.releaseId).sha256,rel.digest);
});
test('wave17: noncritical issues are visible without fabricating a release blocker',t=>{
 const f=fixture(t);f.gov.issueCreate('editor',f.cid,{expectedRevision:f.rev,title:'Optional tone review',details:'A minor tone adjustment might help comprehension.',severity:'minor'});
 assert.deepEqual(f.gov.gate(f.cid),[]);assert.ok(approved(f).releaseId);
});
test('wave18: budget changes require owner and budget limits distinguish warning from hold',t=>{
 const f=fixture(t),rel=approved(f);
 assert.throws(()=>f.gov.budget('editor',f.cid,{expectedRevision:f.rev,currency:'EUR',capMinor:1000,mode:'hold'}),errorCode('FORBIDDEN'));
 f.gov.budget('owner',f.cid,{expectedRevision:f.rev,currency:'EUR',capMinor:1000,mode:'warn'});
 f.adv.addObservation('owner',f.cid,{releaseId:rel.releaseId,date:'2026-10-21',currency:'EUR',spendMinor:1200,impressions:100,clicks:10,leads:2,note:'Actual numbers copied manually from a test record.'});
 assert.equal(f.gov.spending(f.cid).reportedMinor,1200);
 assert.equal(f.gov.spending(f.cid).exceeded,true);
 assert.deepEqual(f.gov.gate(f.cid),[]);
 f.gov.budget('owner',f.cid,{expectedRevision:f.rev,currency:'EUR',capMinor:1000,mode:'hold'});
 assert.ok(f.prod.preflight('owner',f.cid).reasons.includes('REPORTED_BUDGET_CAP_EXCEEDED'));
 const obs=f.adv.measurements('owner',f.cid).observations[0];
 f.adv.retractObservation('owner',f.cid,obs.id,{note:'The spend figure was entered twice in the report.'});
 assert.equal(f.gov.spending(f.cid).reportedMinor,0);
 assert.deepEqual(f.gov.gate(f.cid),[]);
});
test('wave18: invalid cap, currency and stale revisions are rejected',t=>{
 const f=fixture(t),p={expectedRevision:f.rev,currency:'EUR',capMinor:1000,mode:'hold'};
 assert.throws(()=>f.gov.budget('owner',f.cid,{...p,capMinor:-1}),errorCode('VALIDATION'));
 assert.throws(()=>f.gov.budget('owner',f.cid,{...p,currency:'BTC'}),errorCode('VALIDATION'));
 f.gov.budget('owner',f.cid,p);
 assert.throws(()=>f.gov.budget('owner',f.cid,p),errorCode('VERSION_CONFLICT'));
});
test('wave19: owner emergency pause revokes issued partner tokens; cannot replay after resume',t=>{
 const f=fixture(t,{partner:true}),rel=approved(f);
 const d=f.adv.prepareDispatch('owner',f.cid,rel.releaseId,{consent:true,platformId:'A'});
 assert.equal(f.gov.control(f.wid).dispatchPaused,false);
 assert.throws(()=>f.gov.controlUpdate('viewer',f.wid,{dispatchPaused:true,reason:'Temporary partner data security incident'}),errorCode('FORBIDDEN'));
 const paused=f.gov.controlUpdate('owner',f.wid,{dispatchPaused:true,reason:'Temporary partner data security incident'});
 assert.equal(paused.revokedUnclaimed,1);
 assert.equal(f.adv.detail('owner',f.cid).dispatches[0].status,'revoked');
 assert.throws(()=>f.adv.redeemDispatch('A',PARTNER,d.token,'request-id-1'),errorCode('REVOKED'));
 assert.throws(()=>f.adv.prepareDispatch('owner',f.cid,rel.releaseId,{consent:true,platformId:'A'}),errorCode('DISPATCH_PAUSED'));
 f.gov.controlUpdate('owner',f.wid,{dispatchPaused:false,reason:'Partner endpoint reviewed and access restored'});
 assert.throws(()=>f.adv.redeemDispatch('A',PARTNER,d.token,'request-id-1'),errorCode('REVOKED'));
});
test('wave19: owner pause does not erase real receipt from already redeemed dispatch',t=>{
 const f=fixture(t,{partner:true}),rel=approved(f),d=f.adv.prepareDispatch('owner',f.cid,rel.releaseId,{consent:true,platformId:'A'});
 const got=f.adv.redeemDispatch('A',PARTNER,d.token,'idempotent-request-1');assert.equal(got.duplicate,false);
 f.gov.controlUpdate('owner',f.wid,{dispatchPaused:true,reason:'Partner transfer incident requiring a temporary freeze'});
 assert.equal(f.adv.detail('owner',f.cid).dispatches[0].status,'redeemed');
 assert.equal(f.adv.receiptDispatch('A',PARTNER,{dispatchId:d.dispatchId,eventId:'evt-confirm-123',action:'asset_created'}).ok,true);
 assert.equal(f.adv.detail('owner',f.cid).dispatches[0].status,'confirmed');
});
test('wave20: audit bundle includes only authenticated internal state and verifiable SHA256',t=>{
 const f=fixture(t),rel=approved(f),bundle=f.gov.exportAudit('owner',f.cid);
 assert.equal(bundle.payload.schema,'adverse-governance-audit-1');
 assert.equal(bundle.payload.releaseDigests[0].digest,rel.digest);
 assert.equal(createHash('sha256').update(JSON.stringify(bundle.payload)).digest('hex'),bundle.sha256);
 assert.ok(bundle.payload.preflight.ready);assert.equal(bundle.payload.dispatchPaused,false);
 assert.equal(JSON.stringify(bundle).includes(PARTNER),false);
 assert.throws(()=>f.gov.exportAudit('viewer',f.cid),errorCode('FORBIDDEN'));
 assert.throws(()=>f.gov.exportAudit('outsider',f.cid),errorCode('NOT_FOUND'));
});
test('wave20: portfolio reports actual blocked projects and respects membership',t=>{
 const f=fixture(t);f.gov.issueCreate('owner',f.cid,{expectedRevision:f.rev,title:'Critical wording ambiguity',details:'Text could be interpreted as unsupported promises.',severity:'critical'});
 const p=f.gov.portfolio('viewer',f.wid);
 assert.equal(p.total,1);assert.equal(p.withBlockers,1);
 assert.ok(p.campaigns[0].gates.some(x=>x.startsWith('OPEN_CRITICAL_ISSUES')));
 assert.throws(()=>f.gov.portfolio('outsider',f.wid),errorCode('NOT_FOUND'));
});
test('governance privacy cleanup redacts personal notes and reopens contributor checks',t=>{
 const f=fixture(t);f.gov.issueCreate('editor',f.cid,{expectedRevision:f.rev,title:'Sensitive meeting detail',details:'Specific meeting recap should be erased on departure.',severity:'minor'});
 const item=f.gov.detail('owner',f.cid).issues[0];
 assert.equal(f.gov.exportUser('editor').issues.length,1);
 f.gov.cleanupUser('editor');
 assert.equal(f.gov.detail('owner',f.cid).issues[0].details,'[redacted after account deletion]');
 assert.equal(f.gov.detail('owner',f.cid).issues[0].reportedBy,null);
 assert.ok(f.prod.detail('owner',f.cid).campaign.revision>1);
});
