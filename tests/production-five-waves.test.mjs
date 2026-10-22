import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {WorkspaceService} from '../server/workspaces.mjs';
import {ProductionService,checkCreative} from '../server/production.mjs';
import {DEMOS} from '../shared/domain.mjs';
function fixture(t){
 const db=new Store(':memory:');t.after(()=>db.close());
 for(const id of ['owner','reviewer','approver','viewer','outsider'])db.run('INSERT INTO users VALUES(?,?,?,?)',id,id+'@demo.invalid','fake','2026-10-22T00:00:00Z');
 const judge=new JudgeService(db),ws=new WorkspaceService(judge),prod=new ProductionService(judge,ws);
 const wid=ws.create('owner',{name:'ADVERSE Agency'}).id;
 for(const [user,role] of [['reviewer','reviewer'],['approver','reviewer'],['viewer','viewer']]) ws.accept(user,ws.issueInvite('owner',wid,{role}).token);
 const d=DEMOS[0];let caseData=judge.create('owner',{claim:d.claim,draft:d});const caseId=caseData.state.id;
 function cmd(extra={}){return {commandId:randomUUID(),expectedVersion:caseData.state.version,...extra};}
 caseData=judge.act('owner',caseId,cmd({action:'narrow'}));
 caseData=judge.prepare('owner',caseId,cmd({draft:d}));
 caseData=judge.verdict('owner',caseId,cmd({claim:'Create an advertising asset using a clear idea',acknowledged:true}));
 ws.share('owner',wid,caseId);
 return {db,judge,ws,prod,wid,caseId,caseData};
}
function createProd(f){
 const x=f.prod.create('owner',{workspaceId:f.wid,name:'Launch campaign',objective:'Bring new teams into JUDGE',audience:'Small agencies',channel:'social'});
 return {id:x.campaign.id,revision:x.campaign.revision};
}
function attach(f,c){const x=f.prod.attach('owner',c.id,{caseId:f.caseId,expectedRevision:c.revision});c.revision=x.campaign.revision;return x.briefs[0].id;}
function evidence(f,c,briefId){
 const x=f.prod.addEvidence('owner',c.id,{briefId,statement:'The editor can create advertising materials',kind:'document',locator:'internal-demo-product-manual-v1',explanation:'Human must compare this manual with the actual product features.',expectedRevision:c.revision});c.revision=x.campaign.revision;
 const y=f.prod.reviewEvidence('reviewer',c.id,x.evidence[0].id,{expectedRevision:c.revision,inspected:true});c.revision=y.campaign.revision;return y.evidence[0].id;
}
function creative(f,c,briefId){const x=f.prod.creative('owner',c.id,{briefId,channel:'social',language:'en',headline:'Build better ads',body:'Turn a real product fact into a clear ad',cta:'Start a draft',expectedRevision:c.revision});c.revision=x.campaign.revision;return x.creatives[0].id;}
function approved(f){const c=createProd(f),bid=attach(f,c);evidence(f,c,bid);creative(f,c,bid);
 let a=f.prod.requestReview('owner',c.id,{expectedRevision:c.revision,note:'Please evaluate the copy and sources for this campaign.'});
 c.revision=a.campaign.revision;assert.equal(a.campaign.status,'in_review');
 a=f.prod.decide('approver',c.id,{expectedRevision:c.revision,decision:'approve',note:'Editorial meaning and source references checked.'});assert.equal(a.campaign.status,'approved');return {c,bid};
}
test('wave 6: campaign planner is workspace-scoped and optimistic',t=>{
 const f=fixture(t),c=createProd(f);
 assert.equal(f.prod.list('viewer',f.wid).length,1);
 assert.throws(()=>f.prod.list('outsider',f.wid),e=>e.code==='NOT_FOUND');
 assert.throws(()=>f.prod.update('viewer',c.id,{expectedRevision:c.revision,name:'Change it'}),e=>e.code==='FORBIDDEN');
 assert.throws(()=>f.prod.attach('outsider',c.id,{caseId:f.caseId,expectedRevision:c.revision}),e=>e.code==='NOT_FOUND');
 const b=attach(f,c);assert.ok(b);
 assert.throws(()=>f.prod.attach('owner',c.id,{caseId:f.caseId,expectedRevision:1}),e=>e.code==='VERSION_CONFLICT');
 assert.equal(f.prod.detail('viewer',c.id).briefs[0].accessible,true);
});
test('wave 6: revoked shared-case permission blocks retrieval and export',t=>{
 const f=fixture(t),c=createProd(f);attach(f,c);
 f.ws.unshare('owner',f.wid,f.caseId);
 assert.equal(f.prod.detail('viewer',c.id).briefs[0].snapshot,null);
 assert.ok(f.prod.detail('viewer',c.id).preflight.reasons.some(x=>x.startsWith('SOURCE_UNAVAILABLE')));
});
test('wave 7: evidence cannot self-approve or claim verification by algorithm',t=>{
 const f=fixture(t),c=createProd(f),bid=attach(f,c);
 const x=f.prod.addEvidence('owner',c.id,{expectedRevision:c.revision,briefId:bid,statement:'A product can save time',kind:'url',locator:'https://example.org/report',explanation:'Read and inspect this report before approval.'});c.revision=x.campaign.revision;
 assert.throws(()=>f.prod.reviewEvidence('owner',c.id,x.evidence[0].id,{expectedRevision:c.revision,inspected:true}),e=>e.code==='SEPARATION_OF_DUTIES');
 assert.throws(()=>f.prod.reviewEvidence('viewer',c.id,x.evidence[0].id,{expectedRevision:c.revision,inspected:true}),e=>e.code==='FORBIDDEN');
 const reviewed=f.prod.reviewEvidence('reviewer',c.id,x.evidence[0].id,{expectedRevision:c.revision,inspected:true});
 assert.equal(reviewed.evidence[0].reviewStatus,'reviewed');assert.equal(reviewed.preflight.ready,false);
 assert.throws(()=>f.prod.addEvidence('owner',c.id,{expectedRevision:reviewed.campaign.revision,briefId:bid,statement:'a fact statement',kind:'url',locator:'http://unsafe.example.org',explanation:'Unsafe scheme must be rejected.'}),e=>e.code==='VALIDATION');
});
test('wave 8: independent approval and revision gates block self-approval',t=>{
 const f=fixture(t),c=createProd(f),bid=attach(f,c);evidence(f,c,bid);creative(f,c,bid);
 const x=f.prod.requestReview('owner',c.id,{expectedRevision:c.revision,note:'Please review these creative copies carefully.'});
 assert.throws(()=>f.prod.decide('owner',c.id,{expectedRevision:x.campaign.revision,decision:'approve',note:'Looks good enough'}),e=>e.code==='SEPARATION_OF_DUTIES');
 assert.throws(()=>f.prod.release('owner',c.id,{expectedRevision:x.campaign.revision}),e=>e.code==='STATE');
 const y=f.prod.decide('approver',c.id,{expectedRevision:x.campaign.revision,decision:'changes',note:'Please simplify the call to action.'});
 assert.equal(y.campaign.status,'draft');assert.ok(y.campaign.revision>x.campaign.revision);
 assert.throws(()=>f.prod.release('owner',c.id,{expectedRevision:x.campaign.revision}),e=>e.code==='VERSION_CONFLICT');
});
test('wave 9: human-written channel variants are bounded by Unicode and linked briefs',t=>{
 const f=fixture(t),c=createProd(f),bid=attach(f,c);
 const suggestion=f.prod.suggest('owner',c.id,bid,'search','en');
 assert.ok(Array.from(suggestion.headline).length<=30);
 assert.equal(suggestion.generatedBy,'deterministic_trim');
 assert.throws(()=>f.prod.creative('owner',c.id,{expectedRevision:c.revision,briefId:bid,channel:'search',language:'ru',headline:'A'.repeat(31),body:'Safe body',cta:'See now'}),e=>e.code==='TEXT_LIMIT');
 const cr=f.prod.creative('owner',c.id,{expectedRevision:c.revision,briefId:bid,channel:'search',language:'ru',headline:'New idea',body:'Actual product benefits',cta:'Start'});
 assert.equal(cr.creatives.length,1);
 assert.deepEqual(checkCreative({channel:'social',language:'zh',headline:'Two words',body:'Useful body text',cta:'Start'}).language,'zh');
});
test('wave 10: immutable release has digest, audited edition and no confirmed delivery',t=>{
 const f=fixture(t),{c}=approved(f);
 const result=f.prod.release('owner',c.id,{expectedRevision:c.revision});
 assert.match(result.digest,/^[0-9a-f]{64}$/);assert.equal(result.deliveryConfirmed,false);
 const again=f.prod.release('owner',c.id,{expectedRevision:c.revision});assert.equal(again.duplicate,true);assert.equal(again.releaseId,result.releaseId);
 const blob=f.prod.exportRelease('reviewer',c.id,result.releaseId);assert.equal(blob.creatives.length,1);assert.equal(blob.deliveryConfirmed,false);
 assert.throws(()=>f.db.run('UPDATE campaign_releases SET payload=? WHERE id=?','{}',result.releaseId),/immutable release/);
 assert.throws(()=>f.prod.exportRelease('outsider',c.id,result.releaseId),e=>e.code==='NOT_FOUND');
 const detail=f.prod.detail('owner',c.id);assert.ok(detail.events.find(x=>x.type==='release_created'));
});
test('wave 10: case verdict change makes new review and release impossible',t=>{
 const f=fixture(t),{c}=approved(f),s=f.judge.detail('owner',f.caseId).state;
 f.judge.reopen('owner',f.caseId,{expectedVersion:s.version,commandId:randomUUID()});
 assert.ok(f.prod.preflight('owner',c.id).reasons.some(x=>x.startsWith('SOURCE_UNAVAILABLE')));
 assert.throws(()=>f.prod.release('owner',c.id,{expectedRevision:c.revision}),e=>e.code==='PREFLIGHT');
});
test('wave 10: deletion removes member contributions and makes prior approval stale',t=>{
 const f=fixture(t),{c}=approved(f);
 f.prod.cleanupUser('reviewer');
 const row=f.prod.detail('owner',c.id);
 assert.equal(row.evidence[0].reviewStatus,'pending');assert.equal(row.campaign.status,'draft');
 assert.ok(row.campaign.revision>c.revision);
});

test('wave 10: detaching and unsharing after release does not expose the old bundle',t=>{
 const f=fixture(t),{c,bid}=approved(f),r=f.prod.release('owner',c.id,{expectedRevision:c.revision});
 assert.equal(f.prod.exportRelease('viewer',c.id,r.releaseId).creatives.length,1);
 const x=f.prod.detach('owner',c.id,{briefId:bid,expectedRevision:c.revision});
 assert.equal(x.briefs.length,0);f.ws.unshare('owner',f.wid,f.caseId);
 assert.throws(()=>f.prod.exportRelease('viewer',c.id,r.releaseId),e=>e.code==='SOURCE_ACCESS');
});
test('wave 7: a departed inspector cannot satisfy the release preflight',t=>{
 const f=fixture(t),{c}=approved(f);
 assert.equal(f.prod.preflight('owner',c.id).ready,true);
 f.ws.removeMember('owner',f.wid,'reviewer');
 assert.equal(f.prod.preflight('owner',c.id).ready,false);
 assert.throws(()=>f.prod.release('owner',c.id,{expectedRevision:c.revision}),e=>e.code==='PREFLIGHT');
});
test('wave 8: editorial approval is not reusable for a changed objective',t=>{
 const f=fixture(t),{c}=approved(f);
 const after=f.prod.update('owner',c.id,{expectedRevision:c.revision,name:'Refocused campaign',objective:'Measure user comprehension without pretending conversions',audience:'Small agencies',channel:'social'});
 assert.equal(after.campaign.status,'draft');
 assert.ok(after.campaign.revision>c.revision);
 assert.throws(()=>f.prod.release('owner',c.id,{expectedRevision:after.campaign.revision}),e=>e.code==='STATE');
});
