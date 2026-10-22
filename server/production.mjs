/** ADVERSE JUDGE production workflow, waves 6-10.
 * Server-authoritative, workspace-scoped, zero paid service dependencies.
 * A reviewed source means a human inspected it; it is NOT independently verified.
 * Approved means internal editorial approval, not permission to publish or legal advice.
 */
import {randomUUID,createHash} from 'node:crypto';
import {DomainError,text,makeBrief} from '../shared/domain.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS={
  search:{headline:30,body:90,cta:30},
  social:{headline:80,body:250,cta:40},
  email:{headline:78,body:1200,cta:50}
};
const LANGUAGES=new Set(['ru','en','zh']);
const sha=s=>createHash('sha256').update(s).digest('hex');
const len=s=>Array.from(s).length;
function identifier(value,name='id'){
  if(typeof value!=='string'||!ID.test(value))throw new DomainError('VALIDATION',`Invalid ${name}.`);
  return value;
}
function str(v,name,min=1,max=1000){return text(v,name,min,max);}
function dateField(value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^(20|21)\d{2}-\d{2}-\d{2}$/.test(value)||!(Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value))throw new DomainError('VALIDATION','Invalid ISO date.');
  return value;
}
function strictExpected(body,revision){
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==revision)throw new DomainError('VERSION_CONFLICT','The campaign changed; reload its current revision.',409);
}
function checkCreative(input){
  if(!CHANNELS[input.channel])throw new DomainError('CHANNEL','Use search, social, or email.');
  if(!LANGUAGES.has(input.language))throw new DomainError('LANGUAGE','Supported languages: ru, en, zh.');
  const caps=CHANNELS[input.channel],fields={};
  for(const [key,maximum] of Object.entries(caps)){
    fields[key]=str(input[key],key,2,maximum*2);
    if(len(fields[key])>maximum)throw new DomainError('TEXT_LIMIT',`${key} exceeds ${maximum} Unicode characters.`);
  }
  return {channel:input.channel,language:input.language,...fields};
}
export {CHANNELS,checkCreative};

export class ProductionService {
  constructor(judge,workspaces){this.judge=judge;this.ws=workspaces;this.store=judge.store;}
  now(){return this.judge.now();}
  member(user,workspaceId,min='viewer'){return this.ws.member(user,identifier(workspaceId,'workspace'),min);}
  campaign(user,campaignId,min='viewer'){
    const row=this.store.one('SELECT * FROM campaigns WHERE id=?',identifier(campaignId,'campaign'));
    if(!row)throw new DomainError('NOT_FOUND','Campaign not found.',404);
    const membership=this.member(user,row.workspace_id,min);
    return {...row,role:membership.role};
  }
  event(campaignId,actor,type,data){
    this.store.run('INSERT INTO campaign_events(campaign_id,actor_id,type,payload,created_at) VALUES(?,?,?,?,?)',campaignId,actor,type,JSON.stringify(data),this.now());
  }
  bump(row,actor,type,payload){
    this.store.run('UPDATE campaigns SET revision=revision+1,status=?,updated_at=? WHERE id=?','draft',this.now(),row.id);
    this.store.run('UPDATE campaign_reviews SET status=? WHERE campaign_id=? AND status=?','superseded',row.id,'pending');
    this.event(row.id,actor,type,{...payload,fromRevision:row.revision,toRevision:row.revision+1});
  }
  list(user,workspaceId){
    this.member(user,workspaceId);
    return this.store.all(`SELECT id,workspace_id AS workspaceId,name,objective,audience,channel,due_date AS dueDate,
      status,revision,created_at AS createdAt,updated_at AS updatedAt FROM campaigns
      WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 100`,workspaceId);
  }
  create(user,body){
    const workspaceId=identifier(body.workspaceId,'workspace');this.member(user,workspaceId,'reviewer');
    const name=str(body.name,'name',3,100),objective=str(body.objective,'objective',10,500),audience=str(body.audience,'audience',3,200);
    const channel=body.channel;
    if(!CHANNELS[channel])throw new DomainError('CHANNEL','Invalid target channel.');
    const dueDate=dateField(body.dueDate),id=randomUUID(),now=this.now();
    return this.store.tx(()=>{
      if(this.store.one('SELECT COUNT(*) AS n FROM campaigns WHERE workspace_id=?',workspaceId).n>=100)throw new DomainError('LIMIT','Workspace campaign limit reached.',409);
      this.store.run(`INSERT INTO campaigns(id,workspace_id,creator_id,name,objective,audience,channel,due_date,status,revision,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,id,workspaceId,user,name,objective,audience,channel,dueDate,'draft',1,now,now);
      this.event(id,user,'campaign_created',{name,objective,audience,channel});
      return this.detail(user,id);
    });
  }
  update(user,id,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,id,'reviewer');strictExpected(body,c.revision);
      if(c.status==='archived')throw new DomainError('STATE','Archived campaign is read-only.',409);
      const name=str(body.name,'name',3,100),objective=str(body.objective,'objective',10,500),audience=str(body.audience,'audience',3,200);
      if(!CHANNELS[body.channel])throw new DomainError('CHANNEL','Unknown channel.');
      const dueDate=dateField(body.dueDate);
      this.store.run('UPDATE campaigns SET name=?,objective=?,audience=?,channel=?,due_date=? WHERE id=?',name,objective,audience,body.channel,dueDate,id);
      this.bump(c,user,'campaign_updated',{name});return this.detail(user,id);
    });
  }
  // Wave 6. A source case can be used ONLY if explicitly shared with this workspace.
  source(c,caseId){
    identifier(caseId,'case');
    const row=this.store.one(`SELECT ca.state,ca.owner_id FROM workspace_cases wc
       JOIN cases ca ON ca.id=wc.case_id WHERE wc.workspace_id=? AND wc.case_id=?`,c.workspace_id,caseId);
    if(!row)throw new DomainError('SOURCE_ACCESS','The case must be explicitly shared with this workspace.',403);
    const state=JSON.parse(row.state);
    if(state.phase!=='verdict'||!state.verdictId)throw new DomainError('SOURCE_STATE','The source case has no current verdict.',409);
    this.judge.assertIntegrity(row.owner_id,caseId);
    return {state,brief:makeBrief(state)};
  }
  attach(user,campaignId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      if(c.status==='archived')throw new DomainError('STATE','Archived campaign.',409);
      const caseId=identifier(body.caseId,'case'),source=this.source(c,caseId);
      const previous=this.store.one('SELECT id FROM campaign_briefs WHERE campaign_id=? AND case_id=?',campaignId,caseId);
      if(!previous&&this.store.one('SELECT COUNT(*) AS n FROM campaign_briefs WHERE campaign_id=?',campaignId).n>=20)throw new DomainError('LIMIT','Campaign has too many source briefs.',409);
      const briefId=previous?.id??randomUUID();
      if(previous){
        this.store.run('UPDATE campaign_briefs SET verdict_id=?,snapshot=?,created_by=?,created_at=? WHERE id=?',source.state.verdictId,JSON.stringify(source.brief),user,this.now(),briefId);
        this.store.run("UPDATE campaign_evidence SET review_status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE brief_id=?",briefId);
      }else{
        this.store.run('INSERT INTO campaign_briefs VALUES(?,?,?,?,?,?,?)',briefId,campaignId,caseId,source.state.verdictId,JSON.stringify(source.brief),user,this.now());
      }
      this.bump(c,user,previous?'brief_refreshed':'brief_attached',{caseId,briefId,verdictId:source.state.verdictId});
      return this.detail(user,campaignId);
    });
  }
  detach(user,campaignId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      const briefId=identifier(body.briefId,'brief');
      const deleted=this.store.run('DELETE FROM campaign_briefs WHERE id=? AND campaign_id=?',briefId,campaignId);
      if(!deleted.changes)throw new DomainError('NOT_FOUND','Brief not found.',404);
      this.bump(c,user,'brief_detached',{briefId});return this.detail(user,campaignId);
    });
  }
  // Wave 7. A human must review evidence, with a second person when possible.
  addEvidence(user,campaignId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      const briefId=identifier(body.briefId,'brief');
      if(!this.store.one('SELECT 1 FROM campaign_briefs WHERE campaign_id=? AND id=?',campaignId,briefId))throw new DomainError('NOT_FOUND','Campaign brief not found.',404);
      if(this.store.one('SELECT COUNT(*) AS n FROM campaign_evidence WHERE campaign_id=?',campaignId).n>=100)throw new DomainError('LIMIT','Evidence limit reached.',409);
      if(!['document','dataset','url','testimonial'].includes(body.kind))throw new DomainError('VALIDATION','Invalid source type.');
      const statement=str(body.statement,'statement',5,400),locator=str(body.locator,'source locator',5,500),explanation=str(body.explanation,'explanation',10,1000),expiry=dateField(body.expiresAt);
      if(body.kind==='url'){
        let u;try{u=new URL(locator);}catch{throw new DomainError('VALIDATION','Source URL invalid.');}
        if(u.protocol!=='https:'||u.username||u.password)throw new DomainError('VALIDATION','Source must be a public HTTPS URL.');
      }
      const id=randomUUID();
      this.store.run(`INSERT INTO campaign_evidence(id,campaign_id,brief_id,statement,kind,locator,explanation,expires_at,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,id,campaignId,briefId,statement,body.kind,locator,explanation,expiry,user,this.now());
      this.bump(c,user,'evidence_added',{id,briefId,kind:body.kind});return this.detail(user,campaignId);
    });
  }
  reviewEvidence(user,campaignId,evidenceId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      const evidence=this.store.one('SELECT * FROM campaign_evidence WHERE id=? AND campaign_id=?',identifier(evidenceId,'evidence'),campaignId);
      if(!evidence)throw new DomainError('NOT_FOUND','Evidence not found.',404);
      if(evidence.created_by===user)throw new DomainError('SEPARATION_OF_DUTIES','A different team member must inspect the source.',403);
      if(evidence.expires_at&&evidence.expires_at<new Date(this.judge.clock()).toISOString().slice(0,10))throw new DomainError('EXPIRED','Source is past its expiry.',409);
      if(evidence.review_status==='reviewed'&&this.store.one("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'viewer'",c.workspace_id,evidence.reviewed_by))throw new DomainError('STATE','Already reviewed by an active team member.',409);
      if(body.inspected!==true)throw new DomainError('ACK_REQUIRED','Explicit source inspection confirmation required.');
      this.store.run('UPDATE campaign_evidence SET review_status=?,reviewed_by=?,reviewed_at=? WHERE id=?','reviewed',user,this.now(),evidenceId);
      this.bump(c,user,'evidence_inspected',{id:evidenceId,reviewedBy:user});return this.detail(user,campaignId);
    });
  }
  // Wave 9. Copy is written by a person (or seeded deterministically from a real brief).
  suggest(user,campaignId,briefId,channel='search',language='ru'){
    const c=this.campaign(user,campaignId);
    const b=this.store.one('SELECT * FROM campaign_briefs WHERE id=? AND campaign_id=?',identifier(briefId,'brief'),campaignId);
    if(!b)throw new DomainError('NOT_FOUND','Brief not found.',404);
    if(!CHANNELS[channel]||!LANGUAGES.has(language))throw new DomainError('VALIDATION','Unknown format.');
    const source=this.source(c,b.case_id);
    if(source.state.verdictId!==b.verdict_id)throw new DomainError('STALE','Refresh the brief before drafting.',409);
    const caps=CHANNELS[channel],brief=JSON.parse(b.snapshot),short=(s,max)=>Array.from(s||'').slice(0,max).join('').trim();
    const headline=short(brief.finalClaim,caps.headline);
    const body=short(`${brief.declaredFact || brief.finalClaim}`,caps.body);
    const cta=short(brief.desiredAction||'Learn more',caps.cta);
    return {briefId,channel,language,headline,body,cta,generatedBy:'deterministic_trim',note:'Draft only. Verify every promise, audience fit and format requirements before approval.'};
  }
  creative(user,campaignId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      const briefId=identifier(body.briefId,'brief');
      const brief=this.store.one('SELECT * FROM campaign_briefs WHERE id=? AND campaign_id=?',briefId,campaignId);
      if(!brief)throw new DomainError('NOT_FOUND','Brief not found.',404);
      this.source(c,brief.case_id);
      const fields=checkCreative(body);
      if(this.store.one('SELECT COUNT(*) AS n FROM campaign_creatives WHERE campaign_id=?',campaignId).n>=100)throw new DomainError('LIMIT','Too many creatives.',409);
      const id=randomUUID();this.store.run('INSERT INTO campaign_creatives VALUES(?,?,?,?,?,?,?,?,?,?)',id,campaignId,briefId,fields.channel,fields.language,fields.headline,fields.body,fields.cta,user,this.now());
      this.bump(c,user,'creative_created',{id,briefId,channel:fields.channel});return this.detail(user,campaignId);
    });
  }
  removeCreative(user,campaignId,creativeId,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,campaignId,'reviewer');strictExpected(body,c.revision);
      const deleted=this.store.run('DELETE FROM campaign_creatives WHERE id=? AND campaign_id=?',identifier(creativeId,'creative'),campaignId);
      if(!deleted.changes)throw new DomainError('NOT_FOUND','Creative not found.',404);
      this.bump(c,user,'creative_removed',{creativeId});return this.detail(user,campaignId);
    });
  }
  // Wave 8/10: releases only after independently reviewed evidence + independent approval.
  preflight(user,id){
    const c=this.campaign(user,id),reasons=[];
    if(c.status==='archived')reasons.push('ARCHIVED');
    const briefs=this.store.all('SELECT * FROM campaign_briefs WHERE campaign_id=?',id);
    if(!briefs.length)reasons.push('NO_BRIEF');
    const creativeCount=this.store.one('SELECT COUNT(*) AS n FROM campaign_creatives WHERE campaign_id=?',id).n;
    if(!creativeCount)reasons.push('NO_CREATIVE');
    for(const b of briefs){
      try{const source=this.source(c,b.case_id);if(source.state.verdictId!==b.verdict_id)reasons.push('STALE_BRIEF:'+b.case_id);}
      catch{reasons.push('SOURCE_UNAVAILABLE:'+b.case_id);}
      const verified=this.store.one(`SELECT COUNT(*) AS n FROM campaign_evidence e
        JOIN workspace_members m ON m.workspace_id=? AND m.user_id=e.reviewed_by AND m.role<>'viewer'
        WHERE e.brief_id=? AND e.review_status='reviewed' AND (e.expires_at IS NULL OR e.expires_at>=?)`,c.workspace_id,b.id,new Date(this.judge.clock()).toISOString().slice(0,10)).n;
      if(!verified)reasons.push('UNREVIEWED_EVIDENCE:'+b.id);
    }
    if(this.advanced)reasons.push(...this.advanced.qaGate(user,id));
    if(this.governance)reasons.push(...this.governance.gate(id));
    return {ready:reasons.length===0,reasons,briefs:briefs.length,creatives:creativeCount,revision:c.revision};
  }
  requestReview(user,id,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,id,'reviewer');strictExpected(body,c.revision);
      const check=this.preflight(user,id);
      if(!check.ready)throw new DomainError('PREFLIGHT','Complete preflight before editorial review: '+check.reasons.join(', '),409);
      if(c.status!=='draft')throw new DomainError('STATE','Only draft campaigns can enter review.',409);
      const note=str(body.note,'review note',10,500),requestId=randomUUID();
      this.store.run(`INSERT INTO campaign_reviews(id,campaign_id,revision,requested_by,request_note,status,created_at)
          VALUES(?,?,?,?,?,?,?)`,requestId,id,c.revision,user,note,'pending',this.now());
      this.store.run('UPDATE campaigns SET status=?,updated_at=? WHERE id=?','in_review',this.now(),id);
      this.event(id,user,'review_requested',{requestId,revision:c.revision});return this.detail(user,id);
    });
  }
  decide(user,id,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,id,'reviewer');strictExpected(body,c.revision);
      const request=this.store.one('SELECT * FROM campaign_reviews WHERE campaign_id=? AND revision=? AND status=? ORDER BY created_at DESC LIMIT 1',id,c.revision,'pending');
      if(!request||c.status!=='in_review')throw new DomainError('STATE','No current review request.',409);
      if(request.requested_by===user)throw new DomainError('SEPARATION_OF_DUTIES','Review requires a different teammate.',403);
      if(!['approve','changes'].includes(body.decision))throw new DomainError('VALIDATION','Use approve or changes.');
      const note=str(body.note,'decision note',10,700);
      if(body.decision==='approve'){
        const check=this.preflight(user,id);if(!check.ready)throw new DomainError('PREFLIGHT',check.reasons.join(', '),409);
        this.store.run(`UPDATE campaign_reviews SET status='approved',reviewer_id=?,review_note=?,decided_at=? WHERE id=?`,user,note,this.now(),request.id);
        this.store.run('UPDATE campaigns SET status=?,updated_at=? WHERE id=?','approved',this.now(),id);
        this.event(id,user,'review_approved',{revision:c.revision,requestId:request.id});
      }else{
        this.store.run(`UPDATE campaign_reviews SET status='changes_requested',reviewer_id=?,review_note=?,decided_at=? WHERE id=?`,user,note,this.now(),request.id);
        this.bump(c,user,'changes_requested',{note});
      }
      return this.detail(user,id);
    });
  }
  // Wave 10. A digest proves file integrity, not signer identity or external publishing.
  release(user,id,body){
    return this.store.tx(()=>{
      const c=this.campaign(user,id,'reviewer');strictExpected(body,c.revision);
      const old=this.store.one('SELECT * FROM campaign_releases WHERE campaign_id=? AND revision=?',id,c.revision);
      if(old)return {releaseId:old.id,revision:c.revision,digest:old.digest,duplicate:true};
      if(c.status!=='approved')throw new DomainError('STATE','Independent editorial approval required.',409);
      const approval=this.store.one(`SELECT r.*,m.role FROM campaign_reviews r LEFT JOIN workspace_members m
        ON m.workspace_id=? AND m.user_id=r.reviewer_id
        WHERE r.campaign_id=? AND r.revision=? AND r.status='approved'`,c.workspace_id,id,c.revision);
      if(!approval||!approval.role||approval.role==='viewer'||approval.requested_by===approval.reviewer_id)throw new DomainError('APPROVAL_INVALID','Reviewing colleague is no longer authorized.',409);
      const check=this.preflight(user,id);if(!check.ready)throw new DomainError('PREFLIGHT',check.reasons.join(', '),409);
      const briefs=this.store.all('SELECT * FROM campaign_briefs WHERE campaign_id=? ORDER BY created_at,id',id).map(b=>({caseId:b.case_id,verdictId:b.verdict_id,brief:JSON.parse(b.snapshot)}));
      const evidence=this.store.all(`SELECT statement,kind,locator,explanation,expires_at AS expiresAt,
        reviewed_by AS reviewedBy,reviewed_at AS reviewedAt FROM campaign_evidence WHERE campaign_id=? AND review_status='reviewed' ORDER BY created_at,id`,id);
      const creatives=this.store.all('SELECT channel,language,headline,body,cta FROM campaign_creatives WHERE campaign_id=? ORDER BY created_at,id',id);
      const payload={schema:'adverse-editorial-release-1',campaign:{id,name:c.name,objective:c.objective,audience:c.audience,channel:c.channel,revision:c.revision},briefs,evidence,creatives,editorialApproval:{reviewerId:approval.reviewer_id,approvedAt:approval.decided_at,note:approval.review_note},createdAt:this.now(),disclaimer:'Human editorial approval only; not fact verification, legal clearance, platform delivery, or measured marketing impact.'};
      const serialized=JSON.stringify(payload),digest=sha(serialized),releaseId=randomUUID();
      this.store.run('INSERT INTO campaign_releases VALUES(?,?,?,?,?,?,?)',releaseId,id,c.revision,serialized,digest,user,this.now());
      this.event(id,user,'release_created',{releaseId,revision:c.revision,digest});
      return {releaseId,revision:c.revision,digest,deliveryConfirmed:false,exportReady:true};
    });
  }
  exportRelease(user,id,releaseId){
    const c=this.campaign(user,id);
    const row=this.store.one('SELECT * FROM campaign_releases WHERE id=? AND campaign_id=?',identifier(releaseId,'release'),id);
    if(!row)throw new DomainError('NOT_FOUND','Release not found.',404);
    if(sha(row.payload)!==row.digest)throw new DomainError('INTEGRITY','Export digest mismatch; refusing to return altered package.',409);
    const payload=JSON.parse(row.payload);
    // Important: check the historical snapshot, not only currently attached briefs.
    // Detaching then unsharing a case must never reopen access to that old content.
    for(const b of payload.briefs)this.source(c,b.caseId);
    return {id:row.id,sha256:row.digest,...payload,deliveryConfirmed:false};
  }
  detail(user,id){
    const c=this.campaign(user,id),briefs=this.store.all('SELECT * FROM campaign_briefs WHERE campaign_id=? ORDER BY created_at,id',id).map(b=>{
      let accessible=false,stale=true;
      try{const source=this.source(c,b.case_id);accessible=true;stale=source.state.verdictId!==b.verdict_id;}catch{}
      return {id:b.id,caseId:b.case_id,verdictId:b.verdict_id,createdAt:b.created_at,accessible,stale,
        snapshot:accessible?JSON.parse(b.snapshot):null};
    });
    const evidence=this.store.all(`SELECT e.id,e.brief_id AS briefId,e.statement,e.kind,e.locator,e.explanation,e.expires_at AS expiresAt,
      e.review_status AS reviewStatus,e.created_by AS createdBy,e.reviewed_by AS reviewedBy,e.reviewed_at AS reviewedAt,
      e.created_at AS createdAt,
      CASE WHEN e.review_status='reviewed' AND m.user_id IS NOT NULL THEN 1 ELSE 0 END AS reviewValid
      FROM campaign_evidence e LEFT JOIN workspace_members m ON m.workspace_id=? AND m.user_id=e.reviewed_by AND m.role<>'viewer'
      WHERE e.campaign_id=? ORDER BY e.created_at,e.id`,c.workspace_id,id).map(e=>({...e,reviewValid:!!e.reviewValid}));
    const creatives=this.store.all(`SELECT id,brief_id AS briefId,channel,language,headline,body,cta,created_at AS createdAt
      FROM campaign_creatives WHERE campaign_id=? ORDER BY created_at,id`,id);
    const reviews=this.store.all(`SELECT revision,requested_by AS requestedBy,request_note AS requestNote,status,
      reviewer_id AS reviewerId,review_note AS reviewNote,created_at AS createdAt,decided_at AS decidedAt
      FROM campaign_reviews WHERE campaign_id=? ORDER BY created_at DESC`,id);
    const releases=this.store.all(`SELECT id,revision,digest,created_at AS createdAt FROM campaign_releases
      WHERE campaign_id=? ORDER BY revision DESC`,id);
    const events=this.store.all(`SELECT id,type,payload,created_at AS createdAt FROM campaign_events
      WHERE campaign_id=? ORDER BY id DESC LIMIT 100`,id).map(r=>({...r,payload:JSON.parse(r.payload)}));
    return {campaign:{id:c.id,workspaceId:c.workspace_id,name:c.name,objective:c.objective,audience:c.audience,
        channel:c.channel,dueDate:c.due_date,status:c.status,revision:c.revision,role:c.role,createdAt:c.created_at,updatedAt:c.updated_at},
      briefs,evidence,creatives,reviews,releases,events,preflight:this.preflight(user,id),
      notice:'Editorial workflow only. Evidence inspection is human-reported. No advertising-platform connection or performance claim.'};
  }
  exportUser(user){
    // Only contributions within currently accessible workspaces; never expose teammates' secret links.
    const memberships=this.store.all('SELECT workspace_id FROM workspace_members WHERE user_id=?',user);
    return {schema:'adverse-production-user-export-1',campaigns:memberships.flatMap(m=>this.list(user,m.workspace_id).filter(c=>{
      const creator=this.store.one('SELECT creator_id FROM campaigns WHERE id=?',c.id);return creator?.creator_id===user;
    })),evidence:this.store.all('SELECT statement,kind,locator,explanation,created_at FROM campaign_evidence WHERE created_by=?',user),
    creatives:this.store.all('SELECT channel,language,headline,body,cta,created_at FROM campaign_creatives WHERE created_by=?',user),
    reviews:this.store.all('SELECT revision,status,review_note,request_note,created_at FROM campaign_reviews WHERE reviewer_id=? OR requested_by=?',user,user),
    activities:this.store.all('SELECT campaign_id,type,payload,created_at FROM campaign_events WHERE actor_id=?',user)};
  }
  cleanupUser(user){
    // Users can leave surviving workspaces. Their mutable contributions must not
    // silently remain approved: invalidate relevant revisions and scrub authorship.
    const affected=this.store.all(`SELECT c.id FROM campaigns c
      WHERE c.workspace_id NOT IN (SELECT id FROM workspaces WHERE owner_id=?)
      AND (EXISTS(SELECT 1 FROM campaign_evidence e WHERE e.campaign_id=c.id AND (e.created_by=? OR e.reviewed_by=?))
      OR EXISTS(SELECT 1 FROM campaign_creatives v WHERE v.campaign_id=c.id AND v.created_by=?)
      OR EXISTS(SELECT 1 FROM campaign_reviews r WHERE r.campaign_id=c.id AND (r.reviewer_id=? OR r.requested_by=?)))`,user,user,user,user,user,user);
    for(const x of affected){
      const c=this.store.one('SELECT * FROM campaigns WHERE id=?',x.id);
      this.store.run('DELETE FROM campaign_evidence WHERE campaign_id=? AND created_by=?',x.id,user);
      this.store.run("UPDATE campaign_evidence SET review_status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE campaign_id=? AND reviewed_by=?",x.id,user);
      this.store.run('DELETE FROM campaign_creatives WHERE campaign_id=? AND created_by=?',x.id,user);
      this.store.run("UPDATE campaign_reviews SET status='superseded' WHERE campaign_id=? AND (reviewer_id=? OR requested_by=?)",x.id,user,user);
      // Remove previously packaged contributions of the erased member; a released file already downloaded cannot be recalled.
      this.store.run('DELETE FROM campaign_releases WHERE campaign_id=?',x.id);
      this.bump(c,null,'member_data_erased',{});
    }
    this.store.run('UPDATE campaigns SET creator_id=NULL WHERE creator_id=?',user);
    this.store.run('UPDATE campaign_events SET actor_id=NULL WHERE actor_id=?',user);
  }
}
