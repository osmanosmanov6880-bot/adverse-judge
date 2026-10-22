import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {WorkspaceService} from '../server/workspaces.mjs';
import {ProductionService} from '../server/production.mjs';
import {AdvancedService} from '../server/advanced.mjs';
import {DEMOS} from '../shared/domain.mjs';
const SECRET='test-server-signing-secret-for-JUDGE-2026-0123456789';
const PARTNER='test-platform-credential-for-JUDGE-2026-0123456789';
function fixture(t,{partner=false}={}){
 const before=process.env.JUDGE_TEST_PARTNER_KEY;
 if(partner){process.env.JUDGE_TEST_PARTNER_KEY=PARTNER;t.after(()=>{if(before===undefined)delete process.env.JUDGE_TEST_PARTNER_KEY;else process.env.JUDGE_TEST_PARTNER_KEY=before;});}
 const db=new Store(':memory:');t.after(()=>db.close());
 for(const u of ['owner','editor','approver','viewer','outsider'])db.run('INSERT INTO users VALUES(?,?,?,?)',u,u+'@example.test','fake','2026-10-22T00:00:00Z');
 const judge=new JudgeService(db,{platforms:partner?[{id:'A',name:'Partner fixture',mode:'deeplink',verified:true,url:'https://verified-partner.example.org/receive',credentialEnv:'JUDGE_TEST_PARTNER_KEY',confirmedEvents:['asset_created']}]:[],secret:partner?SECRET:''});
 const ws=new WorkspaceService(judge),prod=new ProductionService(judge,ws),adv=new AdvancedService(prod,judge);prod.advanced=adv;
 const wid=ws.create('owner',{name:'Brand Lab'}).id;
 for(const [user,role] of [['editor','reviewer'],['approver','reviewer'],['viewer','viewer']])ws.accept(user,ws.issueInvite('owner',wid,{role}).token);
 const d=DEMOS[0];let data=judge.create('owner',{claim:d.claim,draft:d});const caseId=data.state.id;
 const cmd=body=>({commandId:randomUUID(),expectedVersion:data.state.version,...body});
 data=judge.act('owner',caseId,cmd({action:'narrow'}));data=judge.prepare('owner',caseId,cmd({draft:d}));data=judge.verdict('owner',caseId,cmd({claim:'Build an advertising asset with a clear idea',acknowledged:true}));
 ws.share('owner',wid,caseId);
 const item=prod.create('owner',{workspaceId:wid,name:'Brand campaign',objective:'Promote a reliable ad workflow to small teams',audience:'Small agencies',channel:'social'}),cid=item.campaign.id;
 let r=prod.attach('owner',cid,{caseId,expectedRevision:item.campaign.revision});const bid=r.briefs[0].id;
 const input={briefId:bid,statement:'The product lets users draft advertising copy',kind:'document',locator:'internal-product-manual-v1',explanation:'Compare the claim against the current product manual',expectedRevision:r.campaign.revision};
 r=prod.addEvidence('owner',cid,input);r=prod.reviewEvidence('editor',cid,r.evidence[0].id,{expectedRevision:r.campaign.revision,inspected:true});
 r=prod.creative('owner',cid,{expectedRevision:r.campaign.revision,briefId:bid,channel:'social',language:'en',headline:'Build better ads',body:'Turn a product fact into a clear ad',cta:'Start a draft'});
 return {db,judge,ws,prod,adv,wid,cid,bid,caseId,get rev(){return prod.detail('owner',cid).campaign.revision;}};
}
function release(f){
 let x=f.prod.requestReview('owner',f.cid,{expectedRevision:f.rev,note:'Please independently review the provided facts and materials.'});
 x=f.prod.decide('approver',f.cid,{expectedRevision:x.campaign.revision,decision:'approve',note:'Editorial check completed by another human.'});
 return f.prod.release('owner',f.cid,{expectedRevision:x.campaign.revision});
}
test('wave 11: brand library enforces workspace ownership and optimistic versions',t=>{
 const f=fixture(t),a=f.adv;
 assert.throws(()=>a.brandSave('viewer',f.wid,{name:'My brand',voice:'Plain language for clients'}),e=>e.code==='FORBIDDEN');
 const b=a.brandSave('owner',f.wid,{name:'ADVERSE brand',voice:'Human-readable, precise, no exaggerated promises',forbiddenTerms:['miracle'],requiredTerms:['clear']});
 assert.equal(b.version,1);
 assert.equal(a.brandList('editor',f.wid).length,1);
 assert.throws(()=>a.brandSave('owner',f.wid,{...b,expectedVersion:9}),e=>e.code==='VERSION_CONFLICT');
 assert.throws(()=>a.brandList('outsider',f.wid),e=>e.code==='NOT_FOUND');
 assert.throws(()=>a.brandSave('owner',f.wid,{name:'Another brand',voice:'A real brand voice description',forbiddenTerms:['MIRACLE','miracle']}),e=>e.code==='VALIDATION');
});
test('wave 11: assigning and updating brand invalidates previously signed-off campaign',t=>{
 const f=fixture(t),a=f.adv;
 const b=a.brandSave('owner',f.wid,{name:'Style guard',voice:'Simple credible wording for every audience',forbiddenTerms:['miracle'],requiredTerms:['clear']});
 a.setBrand('owner',f.cid,{expectedRevision:f.rev,brandId:b.id});
 assert.deepEqual(a.qaGate('owner',f.cid),['QUALITY_AUDIT_REQUIRED']);
 const audit=a.quality('owner',f.cid);assert.equal(audit.passed,true);
 const base=f.rev;let req=f.prod.requestReview('owner',f.cid,{expectedRevision:base,note:'Check this version and its honest claims.'});
 f.prod.decide('approver',f.cid,{expectedRevision:req.campaign.revision,decision:'approve',note:'A separate reviewer checked the claims.'});
 a.brandSave('owner',f.wid,{...b,expectedVersion:1,requiredTerms:['clear','documented']});
 assert.equal(f.prod.detail('owner',f.cid).campaign.status,'draft');
 assert.equal(a.qaGate('owner',f.cid)[0],'QUALITY_AUDIT_REQUIRED');
 assert.equal(f.prod.detail('owner',f.cid).campaign.revision,base+1);
});
test('wave 12: explicit locale/format matrix rejects duplicates and blocks missing variants',t=>{
 const f=fixture(t),a=f.adv;
 assert.throws(()=>a.setTargets('viewer',f.cid,{expectedRevision:f.rev,targets:[]}),e=>e.code==='FORBIDDEN');
 assert.throws(()=>a.setTargets('owner',f.cid,{expectedRevision:f.rev,targets:[{channel:'social',language:'zh'},{channel:'social',language:'zh'}]}),e=>e.code==='VALIDATION');
 a.setTargets('owner',f.cid,{expectedRevision:f.rev,targets:[{channel:'social',language:'en'},{channel:'search',language:'ru'}]});
 assert.ok(a.qaGate('owner',f.cid).includes('MISSING_TARGET:search:ru'));
 assert.throws(()=>f.prod.requestReview('owner',f.cid,{expectedRevision:f.rev,note:'Please review all channels and language variants.'}),e=>e.code==='PREFLIGHT');
 let x=f.prod.creative('owner',f.cid,{expectedRevision:f.rev,briefId:f.bid,channel:'search',language:'ru',headline:'Честная реклама',body:'Создайте текст для кампании',cta:'Начать'});
 assert.equal(a.qaGate('owner',f.cid)[0],'QUALITY_AUDIT_REQUIRED');
 const result=a.quality('owner',f.cid);assert.equal(result.passed,true);assert.deepEqual(a.qaGate('owner',f.cid),[]);
 assert.equal(a.quality('owner',f.cid).id,result.id);
});
test('wave 13: reproducible quality blocks forbidden wording but warns on generic absolutes',t=>{
 const f=fixture(t),a=f.adv;
 const brand=a.brandSave('owner',f.wid,{name:'No hype',voice:'Evidence-first product messaging with simple words',forbiddenTerms:['miracle'],requiredTerms:[]});
 a.setBrand('owner',f.cid,{expectedRevision:f.rev,brandId:brand.id});
 f.prod.creative('owner',f.cid,{expectedRevision:f.rev,briefId:f.bid,channel:'social',language:'en',headline:'Miracle strategy',body:'Guaranteed growth for every team',cta:'Act now'});
 const result=a.quality('owner',f.cid);
 assert.equal(result.passed,false);
 assert.ok(result.findings.some(x=>x.code==='FORBIDDEN_TERM'));
 assert.ok(result.findings.some(x=>x.code==='ABSOLUTE_CLAIM_REVIEW'&&x.severity==='warning'));
 assert.ok(f.prod.preflight('owner',f.cid).reasons.includes('QUALITY_BLOCKERS'));
 assert.throws(()=>f.prod.requestReview('owner',f.cid,{expectedRevision:f.rev,note:'Could this bad draft receive approval?'}),e=>e.code==='PREFLIGHT');
});
test('wave 14: a partner cannot redeem another platform token, replay with new ID or confirm twice',t=>{
 const f=fixture(t,{partner:true}),a=f.adv;
 const out=release(f);
 const ticket=a.prepareDispatch('owner',f.cid,out.releaseId,{consent:true,platformId:'A'});
 assert.match(ticket.token,/\./);assert.equal(a.detail('owner',f.cid).dispatches[0].status,'issued');
 assert.throws(()=>a.redeemDispatch('B',PARTNER,ticket.token,'stable-request-0001'),e=>e.code==='AUTH');
 const data=a.redeemDispatch('A',PARTNER,ticket.token,'stable-request-0001');assert.equal(data.sha256,out.digest);
 assert.equal(data.payload.creatives.length,1);assert.equal(data.duplicate,false);
 assert.equal(a.redeemDispatch('A',PARTNER,ticket.token,'stable-request-0001').duplicate,true);
 assert.throws(()=>a.redeemDispatch('A',PARTNER,ticket.token,'other-request-0002'),e=>e.code==='REDEEMED');
 assert.throws(()=>a.receiptDispatch('A',PARTNER,{dispatchId:ticket.dispatchId,eventId:'evt-creation-123',action:'impressions'}),e=>e.code==='EVENT_CONTRACT');
 assert.equal(a.receiptDispatch('A',PARTNER,{dispatchId:ticket.dispatchId,eventId:'evt-creation-123',action:'asset_created'}).duplicate,false);
 assert.equal(a.receiptDispatch('A',PARTNER,{dispatchId:ticket.dispatchId,eventId:'evt-creation-123',action:'asset_created'}).duplicate,true);
 assert.throws(()=>a.receiptDispatch('A',PARTNER,{dispatchId:ticket.dispatchId,eventId:'evt-creation-124',action:'asset_created'}),e=>e.code==='STATE');
 assert.equal(a.detail('owner',f.cid).dispatches[0].status,'confirmed');
 assert.throws(()=>a.prepareDispatch('owner',f.cid,out.releaseId,{consent:true,platformId:'A'}),e=>e.code==='DUPLICATE');
});
test('wave 14: revoked and stale dispatches are not redeemable; no confirmation inferred from export',t=>{
 const f=fixture(t,{partner:true}),a=f.adv;
 const out=release(f),d=a.prepareDispatch('owner',f.cid,out.releaseId,{consent:true,platformId:'A'});
 a.revokeDispatch('owner',f.cid,d.dispatchId);
 assert.throws(()=>a.redeemDispatch('A',PARTNER,d.token,'stable-request-0003'),e=>e.code==='REVOKED');
 assert.equal(a.detail('owner',f.cid).dispatches[0].status,'revoked');
 const manual=f.prod.exportRelease('owner',f.cid,out.releaseId);assert.equal(manual.deliveryConfirmed,false);
});
test('wave 15: manual observation requires a release, rejects invented future/invalid funnels, reports by currency',t=>{
 const f=fixture(t),a=f.adv,out=release(f);
 assert.throws(()=>a.addObservation('viewer',f.cid,{releaseId:out.releaseId}),e=>e.code==='FORBIDDEN');
 const payload={releaseId:out.releaseId,date:'2026-10-21',currency:'EUR',spendMinor:4500,impressions:1200,clicks:100,leads:12,note:'Entered from test analytics export, values are not verified by JUDGE.'};
 assert.throws(()=>a.addObservation('owner',f.cid,{...payload,leads:101}),e=>e.code==='MEASUREMENT');
 assert.throws(()=>a.addObservation('owner',f.cid,{...payload,date:'2026-02-30'}),e=>e.code==='VALIDATION');
 const first=a.addObservation('owner',f.cid,payload);assert.equal(first.totals[0].ctrPercent,8.33);
 assert.equal(first.totals[0].costPerLeadMinor,375);
 assert.equal(first.observations[0].source,'manual');
 a.addObservation('owner',f.cid,{...payload,currency:'SEK',spendMinor:2000});assert.equal(a.measurements('owner',f.cid).totals.length,2);
 const removed=a.retractObservation('owner',f.cid,first.observations[0].id,{note:'Imported the wrong manual analytics period.'});
 assert.equal(removed.totals.length,1);
 assert.equal(removed.observations.filter(x=>x.retractedAt).length,1);
 assert.throws(()=>a.retractObservation('owner',f.cid,first.observations[0].id,{note:'Already retracted manually'}),e=>e.code==='STATE');
});
test('five waves: no trust expansion across workspace, campaign and missing integration',t=>{
 const f=fixture(t),a=f.adv;
 assert.throws(()=>a.detail('outsider',f.cid),e=>e.code==='NOT_FOUND');
 assert.throws(()=>a.quality('outsider',f.cid),e=>e.code==='NOT_FOUND');
 assert.throws(()=>a.prepareDispatch('owner',f.cid,randomUUID(),{platformId:'A',consent:true}),e=>e.code==='NOT_FOUND');
 assert.throws(()=>a.addObservation('owner',f.cid,{releaseId:randomUUID()}),e=>e.code==='NOT_FOUND');
 const b=a.brandSave('owner',f.wid,{name:'Guardian',voice:'Use plain words and explain real value'});
 assert.throws(()=>a.setBrand('outsider',f.cid,{brandId:b.id,expectedRevision:f.rev}),e=>e.code==='NOT_FOUND');
});
