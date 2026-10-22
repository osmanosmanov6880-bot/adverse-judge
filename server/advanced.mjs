/** WAVE 11-15. Reviewable brand constraints, locale matrix, deterministic QC,
 * authenticated partner release exchange and provenance-labelled measurements.
 * No inferred conversion, external delivery or legal clearance is ever fabricated.
 */
import {randomUUID,createHash} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
import {signPayload,verifyPayload,hash,equal} from './security.mjs';
import {integrationReadiness} from './platform-config.mjs';
import {CHANNELS} from './production.mjs';
const LANG=new Set(['ru','en','zh']);
const CURRENCIES=new Set(['EUR','USD','SEK','GBP']);
const sha=s=>createHash('sha256').update(s).digest('hex');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(v,n='ID'){if(typeof v!=='string'||!ID.test(v))throw new DomainError('VALIDATION','Invalid '+n);return v;}
function fields(list,label){
 if(!Array.isArray(list)||list.length>12)throw new DomainError('VALIDATION',label+': max 12 terms.');
 const items=list.map(x=>text(x,label,2,60).trim());
 if(new Set(items.map(x=>x.toLocaleLowerCase())).size!==items.length)throw new DomainError('VALIDATION',label+': terms must be unique.');
 return items;
}
function expected(input,c){if(input.expectedRevision!==c.revision)throw new DomainError('VERSION_CONFLICT','Campaign revision changed. Refresh.',409);}
function positiveInteger(v,label,max){if(!Number.isSafeInteger(v)||v<0||v>max)throw new DomainError('VALIDATION',label+' out of range.');return v;}
function measureDate(date){
 if(typeof date!=='string'||!/^20\d\d-\d\d-\d\d$/.test(date)||new Date(date+'T00:00:00.000Z').toISOString().slice(0,10)!==date)throw new DomainError('VALIDATION','Date must use YYYY-MM-DD.');
 if(Date.parse(date+'T00:00:00Z')>Date.now()+86400000)throw new DomainError('VALIDATION','Future performance is not observable.');
 return date;
}
export class AdvancedService {
 constructor(prod,judge){this.prod=prod;this.judge=judge;this.ws=prod.ws;this.store=judge.store;}
 now(){return this.prod.now();}
 event(cid,actor,kind,payload){this.store.run('INSERT INTO advanced_events(campaign_id,actor_id,kind,payload,created_at) VALUES(?,?,?,?,?)',cid,actor,kind,JSON.stringify(payload),this.now());}
 campaign(user,cid,minimum='viewer'){return this.prod.campaign(user,cid,minimum);}
 brandList(user,wid){this.prod.member(user,wid);return this.store.all('SELECT id,name,voice,forbidden_terms AS forbiddenTerms,required_terms AS requiredTerms,version,created_at AS createdAt FROM brand_kits WHERE workspace_id=? ORDER BY name',wid).map(r=>({...r,forbiddenTerms:JSON.parse(r.forbiddenTerms),requiredTerms:JSON.parse(r.requiredTerms)}));}
 brandSave(user,wid,input){
  const membership=this.prod.member(user,wid,'owner');
  const name=text(input.name,'Brand name',3,100),voice=text(input.voice,'Tone of voice',10,500),forbidden=fields(input.forbiddenTerms??[],'Forbidden terms'),required=fields(input.requiredTerms??[],'Required terms');
  return this.store.tx(()=>{
   const now=this.now();let brandId,version=1;
   if(input.id){
    brandId=id(input.id,'brand');const b=this.store.one('SELECT * FROM brand_kits WHERE id=? AND workspace_id=?',brandId,wid);
    if(!b)throw new DomainError('NOT_FOUND','Brand not found.',404);
    if(input.expectedVersion!==b.version)throw new DomainError('VERSION_CONFLICT','Brand rules changed. Refresh.',409);
    version=b.version+1;
    this.store.run('UPDATE brand_kits SET name=?,voice=?,forbidden_terms=?,required_terms=?,version=?,updated_at=? WHERE id=?',name,voice,JSON.stringify(forbidden),JSON.stringify(required),version,now,brandId);
    for(const x of this.store.all('SELECT campaign_id FROM campaign_brand WHERE brand_id=?',brandId)){
      const c=this.store.one('SELECT * FROM campaigns WHERE id=?',x.campaign_id);
      this.prod.bump(c,user,'brand_policy_updated',{brandId,brandVersion:version});
    }
   }else{
    if(this.store.one('SELECT COUNT(*) AS n FROM brand_kits WHERE workspace_id=?',wid).n>=25)throw new DomainError('LIMIT','Too many brands.',409);
    brandId=randomUUID();this.store.run('INSERT INTO brand_kits VALUES(?,?,?,?,?,?,?,?,?)',brandId,wid,name,voice,JSON.stringify(forbidden),JSON.stringify(required),version,now,now);
   }
   return {id:brandId,version,name,voice,forbiddenTerms:forbidden,requiredTerms:required};
  });
 }
 setBrand(user,cid,input){
  return this.store.tx(()=>{
   const c=this.campaign(user,cid,'reviewer');expected(input,c);
   let brandId=null;
   if(input.brandId){brandId=id(input.brandId,'brand');if(!this.store.one('SELECT 1 FROM brand_kits WHERE id=? AND workspace_id=?',brandId,c.workspace_id))throw new DomainError('NOT_FOUND','Brand is not in this workspace.',404);}
   const prev=this.store.one('SELECT brand_id FROM campaign_brand WHERE campaign_id=?',cid)?.brand_id||null;
   if(prev===brandId)return this.detail(user,cid);
   this.store.run('DELETE FROM campaign_brand WHERE campaign_id=?',cid);
   if(brandId)this.store.run('INSERT INTO campaign_brand VALUES(?,?)',cid,brandId);
   this.prod.bump(c,user,'campaign_brand_assigned',{brandId});return this.detail(user,cid);
  });
 }
 setTargets(user,cid,input){
  return this.store.tx(()=>{
   const c=this.campaign(user,cid,'reviewer');expected(input,c);
   if(!Array.isArray(input.targets)||input.targets.length>9)throw new DomainError('VALIDATION','Up to 9 locale targets.');
   const targets=input.targets.map(p=>{
    if(!p||!Object.hasOwn(CHANNELS,p.channel)||!LANG.has(p.language))throw new DomainError('VALIDATION','Unsupported channel/locale target.');
    return {channel:p.channel,language:p.language};
   });
   if(new Set(targets.map(x=>x.channel+':'+x.language)).size!==targets.length)throw new DomainError('VALIDATION','Duplicate locale target.');
   const prev=this.targets(cid).map(x=>x.channel+':'+x.language).sort().join('|');
   const next=targets.map(x=>x.channel+':'+x.language).sort().join('|');
   if(prev===next)return this.detail(user,cid);
   this.store.run('DELETE FROM campaign_targets WHERE campaign_id=?',cid);
   for(const t of targets)this.store.run('INSERT INTO campaign_targets VALUES(?,?,?)',cid,t.channel,t.language);
   this.prod.bump(c,user,'locale_targets_changed',{targets});return this.detail(user,cid);
  });
 }
 targets(cid){return this.store.all('SELECT channel,language FROM campaign_targets WHERE campaign_id=? ORDER BY channel,language',cid);}
 brand(cid){const b=this.store.one('SELECT k.* FROM brand_kits k JOIN campaign_brand cb ON cb.brand_id=k.id WHERE cb.campaign_id=?',cid);return b?{id:b.id,version:b.version,name:b.name,voice:b.voice,forbiddenTerms:JSON.parse(b.forbidden_terms),requiredTerms:JSON.parse(b.required_terms)}:null;}
 scan(cid){
  const c=this.store.one('SELECT revision FROM campaigns WHERE id=?',cid);
  const creatives=this.store.all('SELECT id,channel,language,headline,body,cta FROM campaign_creatives WHERE campaign_id=? ORDER BY id',cid),brand=this.brand(cid),targets=this.targets(cid);
  const findings=[];
  for(const target of targets)if(!creatives.some(x=>x.channel===target.channel&&x.language===target.language))findings.push({severity:'blocker',code:'MISSING_TARGET',target:target.channel+':'+target.language});
  for(const creative of creatives){
   const content=[creative.headline,creative.body,creative.cta].join(' ').toLocaleLowerCase();
   for(const term of brand?.forbiddenTerms||[])if(content.includes(term.toLocaleLowerCase()))findings.push({severity:'blocker',code:'FORBIDDEN_TERM',creativeId:creative.id,term});
   for(const term of brand?.requiredTerms||[])if(!content.includes(term.toLocaleLowerCase()))findings.push({severity:'blocker',code:'MISSING_REQUIRED_TERM',creativeId:creative.id,term});
   if(/\b(guaranteed|100%|best|no risk)\b|гарантир(?:уем|овано)|лучший|百分之百/i.test(content))findings.push({severity:'warning',code:'ABSOLUTE_CLAIM_REVIEW',creativeId:creative.id});
   if(creative.headline.toLocaleLowerCase()===creative.body.toLocaleLowerCase())findings.push({severity:'warning',code:'DUPLICATED_COPY',creativeId:creative.id});
  }
  const fingerprint=sha(JSON.stringify({revision:c.revision,brand,targets,creatives}));
  return {revision:c.revision,fingerprint,findings,passed:!findings.some(x=>x.severity==='blocker'),creatives:creatives.length,brandName:brand?.name||null};
 }
 quality(user,cid){
  return this.store.tx(()=>{
   const c=this.campaign(user,cid,'reviewer'),audit=this.scan(cid);
   const existing=this.store.one('SELECT * FROM campaign_quality_runs WHERE campaign_id=? AND revision=?',cid,c.revision);
   if(existing){if(existing.digest!==audit.fingerprint)throw new DomainError('INTEGRITY','The audited campaign changed without revision.',409);return this.qualityRow(existing);}
   const auditId=randomUUID(),now=this.now();this.store.run('INSERT INTO campaign_quality_runs VALUES(?,?,?,?,?,?,?,?)',auditId,cid,c.revision,audit.fingerprint,JSON.stringify(audit.findings),audit.passed?1:0,user,now);
   this.event(cid,user,'quality_scan',{auditId,revision:c.revision,passed:audit.passed,findings:audit.findings.length});
   return {id:auditId,createdAt:now,...audit};
  });
 }
 qualityRow(row){return {id:row.id,revision:row.revision,fingerprint:row.digest,findings:JSON.parse(row.findings),passed:!!row.passed,createdAt:row.created_at};}
 qaGate(user,cid){
  const c=this.campaign(user,cid),reasons=[];
  const targets=this.targets(cid),brand=this.brand(cid);
  for(const t of targets){if(!this.store.one('SELECT 1 FROM campaign_creatives WHERE campaign_id=? AND channel=? AND language=?',cid,t.channel,t.language))reasons.push('MISSING_TARGET:'+t.channel+':'+t.language);}
  if(brand||targets.length){
   const row=this.store.one('SELECT * FROM campaign_quality_runs WHERE campaign_id=? AND revision=?',cid,c.revision);
   if(!row)reasons.push('QUALITY_AUDIT_REQUIRED');
   else if(row.digest!==this.scan(cid).fingerprint)reasons.push('QUALITY_AUDIT_STALE');
   else if(!row.passed)reasons.push('QUALITY_BLOCKERS');
  }
  return reasons;
 }
 releaseRow(user,cid,rid){
  const c=this.campaign(user,cid,'reviewer'),row=this.store.one('SELECT * FROM campaign_releases WHERE id=? AND campaign_id=?',id(rid,'release'),cid);
  if(!row)throw new DomainError('NOT_FOUND','Release not found.',404);
  return {c,row};
 }
 prepareDispatch(user,cid,rid,input){
  if(input.consent!==true)throw new DomainError('CONSENT','Explicit partner transfer consent is required.',400);
  const {c,row}=this.releaseRow(user,cid,rid);
  if(c.revision!==row.revision||c.status!=='approved'||!this.prod.preflight(user,cid).ready)throw new DomainError('STALE_RELEASE','Only the current approved release can be transferred.',409);
  if(this.governance)this.governance.assertDispatchAllowed(c.workspace_id);
  this.prod.exportRelease(user,cid,rid);
  const p=this.judge.platforms.find(p=>p.id===input.platformId);
  if(!p)throw new DomainError('PLATFORM','Unknown platform.',400);
  if(!integrationReadiness(p,{secret:this.judge.secret,env:{...process.env,...(this.judge.env||{})}}).configured)throw new DomainError('NOT_CONFIGURED','Partner credentials and contract are not configured.',503);
  return this.store.tx(()=>{
   if(this.store.one('SELECT id FROM release_dispatches WHERE release_id=? AND platform_id=?',rid,p.id))throw new DomainError('DUPLICATE','A handoff already exists for this release/platform.',409);
   const dispatchId=randomUUID(),exp=this.judge.clock()+3600000;
   const ticket=signPayload({v:1,kind:'release',id:dispatchId,platform:p.id,exp},this.judge.secret);
   this.store.run(`INSERT INTO release_dispatches(id,release_id,campaign_id,platform_id,token_hash,expires_at,status,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`,dispatchId,rid,cid,p.id,hash(ticket),exp,'issued',user,this.now());
   this.event(cid,user,'dispatch_issued',{dispatchId,platformId:p.id,releaseId:rid});
   return {dispatchId,platformId:p.id,token:ticket,expiresAt:exp,status:'issued',note:'Authenticated receipt required; preparing is not delivering.'};
  });
 }
 revokeDispatch(user,cid,did){
  return this.store.tx(()=>{
   this.campaign(user,cid,'reviewer');const d=this.store.one('SELECT * FROM release_dispatches WHERE id=? AND campaign_id=?',id(did,'dispatch'),cid);
   if(!d)throw new DomainError('NOT_FOUND','Dispatch not found.',404);
   if(d.status!=='issued')throw new DomainError('STATE','Received materials cannot be recalled by JUDGE.',409);
   this.store.run("UPDATE release_dispatches SET status='revoked' WHERE id=?",did);
   this.event(cid,user,'dispatch_revoked',{dispatchId:did});return {ok:true};
  });
 }
 redeemDispatch(platformId,credential,ticket,requestId){
  this.judge.authenticateIntegration(platformId,credential);
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw new DomainError('REQUEST_ID','Stable requestId is required.');
  const data=verifyPayload(ticket,this.judge.secret,this.judge.clock());
  if(data.kind!=='release'||data.platform!==platformId)throw new DomainError('TOKEN','Token is not for this platform.',403);
  return this.store.tx(()=>{
   const d=this.store.one('SELECT * FROM release_dispatches WHERE id=? AND platform_id=?',data.id,platformId);
   if(!d||!equal(d.token_hash,hash(ticket)))throw new DomainError('NOT_FOUND','Dispatch not found.',404);
   if(d.status==='revoked')throw new DomainError('REVOKED','Dispatch revoked.',410);
   if(d.expires_at<=this.judge.clock())throw new DomainError('EXPIRED','Dispatch expired.',410);
   if(this.governance){const campaign=this.store.one('SELECT workspace_id FROM campaigns WHERE id=?',d.campaign_id);this.governance.assertDispatchAllowed(campaign.workspace_id);}
   const requestHash=hash(platformId+':'+requestId),duplicate=d.status!=='issued';
   if(duplicate&&(!d.redeem_request_hash||!equal(d.redeem_request_hash,requestHash)||this.judge.clock()-Date.parse(d.redeemed_at)>300000))throw new DomainError('REDEEMED','Dispatch already redeemed.',409);
   const c=this.store.one('SELECT * FROM campaigns WHERE id=?',d.campaign_id),release=this.store.one('SELECT * FROM campaign_releases WHERE id=?',d.release_id);
   if(!c||!release||c.revision!==release.revision||c.status!=='approved')throw new DomainError('STALE_RELEASE','Campaign was changed after release.',410);
   if(this.governance&&this.governance.gate(d.campaign_id).length)throw new DomainError('GOVERNANCE_HOLD','Campaign risks or budget hold prevent delivery.',409);
   const workspaceOwner=this.store.one("SELECT user_id FROM workspace_members WHERE workspace_id=? AND role='owner'",c.workspace_id);
   if(!workspaceOwner)throw new DomainError('SOURCE_ACCESS','Workspace owner missing.',410);
   const blob=this.prod.exportRelease(workspaceOwner.user_id,c.id,release.id);
   if(!duplicate){
    this.store.run("UPDATE release_dispatches SET status='redeemed',redeemed_at=?,redeem_request_hash=? WHERE id=?",this.now(),requestHash,d.id);
    this.event(c.id,null,'dispatch_redeemed',{dispatchId:d.id,platformId});
   }
   return {dispatchId:d.id,releaseId:d.release_id,sha256:release.digest,payload:blob,duplicate};
  });
 }
 receiptDispatch(platformId,credential,input){
  const p=this.judge.authenticateIntegration(platformId,credential);
  if(!Array.isArray(p.confirmedEvents)||!p.confirmedEvents.includes(input.action))throw new DomainError('EVENT_CONTRACT','Action not permitted by partner contract.',403);
  const eventId=text(input.eventId,'Event id',8,100),dispatchId=id(input.dispatchId,'dispatch');
  return this.store.tx(()=>{
   const old=this.store.one('SELECT * FROM dispatch_receipts WHERE platform_id=? AND event_id=?',platformId,eventId);
   if(old){if(old.dispatch_id!==dispatchId||old.action!==input.action)throw new DomainError('EVENT_CONFLICT','Event id reused for a different action.',409);return {ok:true,duplicate:true};}
   const d=this.store.one('SELECT * FROM release_dispatches WHERE id=? AND platform_id=?',dispatchId,platformId);
   if(!d||d.status!=='redeemed')throw new DomainError('STATE','Partner must redeem once before confirming. No second confirmation allowed.',409);
   this.store.run('INSERT INTO dispatch_receipts VALUES(?,?,?,?,?)',platformId,eventId,dispatchId,input.action,this.now());
   this.store.run("UPDATE release_dispatches SET status='confirmed',confirmed_at=?,confirmed_action=?,confirmed_event_id=? WHERE id=?",this.now(),input.action,eventId,d.id);
   this.event(d.campaign_id,null,'dispatch_confirmed',{dispatchId,platformId,action:input.action,eventId});
   return {ok:true,duplicate:false};
  });
 }
 addObservation(user,cid,input){
  const c=this.campaign(user,cid,'reviewer'),releaseId=id(input.releaseId,'release');
  if(!this.store.one('SELECT 1 FROM campaign_releases WHERE id=? AND campaign_id=?',releaseId,cid))throw new DomainError('NOT_FOUND','Release not found.',404);
  const day=measureDate(input.date),currency=input.currency;
  if(!CURRENCIES.has(currency))throw new DomainError('CURRENCY','Unsupported currency.');
  const spend=positiveInteger(input.spendMinor,'Spend in minor units',1000000000),impressions=positiveInteger(input.impressions,'Impressions',1000000000),clicks=positiveInteger(input.clicks,'Clicks',1000000000),leads=positiveInteger(input.leads,'Leads',1000000000);
  if(clicks>impressions||leads>clicks)throw new DomainError('MEASUREMENT','Leads cannot exceed clicks; clicks cannot exceed impressions.');
  const note=text(input.note,'Source/measurement note',12,500),oid=randomUUID();
  return this.store.tx(()=>{
   if(this.store.one('SELECT COUNT(*) AS n FROM campaign_observations WHERE campaign_id=?',cid).n>=500)throw new DomainError('LIMIT','Maximum 500 observations per campaign.',409);
   this.store.run(`INSERT INTO campaign_observations(id,campaign_id,release_id,date,source,spend_minor,impressions,clicks,leads,currency,note,actor_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,oid,cid,releaseId,day,'manual',spend,impressions,clicks,leads,currency,note,user,this.now());
   this.event(cid,user,'manual_observation_added',{id:oid,date:day,releaseId,source:'manual'});
   return this.measurements(user,cid);
  });
 }
 retractObservation(user,cid,oid,input){
  this.campaign(user,cid,'reviewer');const note=text(input.note,'Retraction reason',10,500);
  return this.store.tx(()=>{
   const row=this.store.one('SELECT * FROM campaign_observations WHERE campaign_id=? AND id=?',cid,id(oid,'observation'));
   if(!row)throw new DomainError('NOT_FOUND','Observation not found.',404);
   if(row.retracted_at)throw new DomainError('STATE','Already retracted.',409);
   this.store.run('UPDATE campaign_observations SET retracted_at=?,retracted_by=?,retraction_note=? WHERE id=?',this.now(),user,note,oid);
   this.event(cid,user,'manual_observation_retracted',{id:oid});return this.measurements(user,cid);
  });
 }
 measurements(user,cid){
  this.campaign(user,cid);
  const rows=this.store.all(`SELECT id,release_id AS releaseId,date,source,spend_minor AS spendMinor,impressions,clicks,leads,currency,note,created_at AS createdAt,retracted_at AS retractedAt,retraction_note AS retractionNote
    FROM campaign_observations WHERE campaign_id=? ORDER BY date DESC,created_at DESC`,cid);
  const totals={};for(const r of rows.filter(x=>!x.retractedAt)){
   const sum=totals[r.currency]??(totals[r.currency]={currency:r.currency,spendMinor:0,impressions:0,clicks:0,leads:0});
   for(const key of ['spendMinor','impressions','clicks','leads'])sum[key]+=r[key];
  }
  for(const x of Object.values(totals)){x.ctrPercent=x.impressions?+(x.clicks*100/x.impressions).toFixed(2):null;x.costPerLeadMinor=x.leads?Math.round(x.spendMinor/x.leads):null;}
  return {observations:rows,totals:Object.values(totals),disclaimer:'Manual reports supplied by users, not platform-verified. No ROI, revenue or attribution is inferred.'};
 }
 detail(user,cid){
  const c=this.campaign(user,cid),br=this.brand(cid),quality=this.store.one('SELECT * FROM campaign_quality_runs WHERE campaign_id=? ORDER BY revision DESC LIMIT 1',cid);
  return {campaignId:c.id,revision:c.revision,role:c.role,workspaceId:c.workspace_id,brand:br,brands:this.brandList(user,c.workspace_id),targets:this.targets(cid),
    quality:quality?this.qualityRow(quality):null,qaGate:this.qaGate(user,cid),
    releases:this.store.all('SELECT id,revision,digest,created_at AS createdAt FROM campaign_releases WHERE campaign_id=? ORDER BY created_at DESC',cid),
    dispatches:this.store.all('SELECT id,release_id AS releaseId,platform_id AS platformId,status,expires_at AS expiresAt,created_at AS createdAt,confirmed_action AS confirmedAction FROM release_dispatches WHERE campaign_id=? ORDER BY created_at DESC',cid),
    measurements:this.measurements(user,cid),events:this.store.all('SELECT kind,created_at AS createdAt FROM advanced_events WHERE campaign_id=? ORDER BY id DESC LIMIT 20',cid),
    platforms:this.judge.platformList()};
 }
 exportUser(user){
  return {brandRules:this.store.all('SELECT name,voice,forbidden_terms,required_terms,created_at FROM brand_kits WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=?)',user),
    manualObservations:this.store.all('SELECT campaign_id,release_id,date,source,spend_minor,impressions,clicks,leads,currency,note,retracted_at FROM campaign_observations WHERE actor_id=?',user)};
 }
 cleanupUser(user){
  // Destroy personal performance notes entered by the departing member, keeping
  // audit trail of erasure without retaining their input data in live UI.
  for(const row of this.store.all('SELECT id,campaign_id FROM campaign_observations WHERE actor_id=?',user))this.store.run('DELETE FROM campaign_observations WHERE id=?',row.id);
  this.store.run("UPDATE campaign_observations SET retracted_by=NULL,retraction_note='[removed after account deletion]' WHERE retracted_by=?",user);
  this.store.run('UPDATE advanced_events SET actor_id=NULL WHERE actor_id=?',user);
  this.store.run('UPDATE release_dispatches SET created_by=NULL WHERE created_by=?',user);
  this.store.run('UPDATE campaign_quality_runs SET actor_id=NULL WHERE actor_id=?',user);
 }
}
