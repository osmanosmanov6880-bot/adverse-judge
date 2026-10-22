/** ADVERSE JUDGE WAVE 16-20: traceable claims, independent risk resolution,
 * declared budget, emergency partner pause and verifiable internal audit export.
 * A mapped source was checked by a teammate, NOT factually authenticated.
 */
import {randomUUID,createHash} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCIES=new Set(['EUR','USD','SEK','GBP']);
function uuid(v,label='id'){if(typeof v!=='string'||!ID.test(v))throw new DomainError('VALIDATION','Invalid '+label);return v;}
function expected(body,c){if(body.expectedRevision!==c.revision)throw new DomainError('VERSION_CONFLICT','Campaign changed; refresh before editing.',409);if(c.status==='archived')throw new DomainError('STATE','Archived campaigns are read-only.',409);}
function bool(v,label){if(typeof v!=='boolean')throw new DomainError('VALIDATION',label+' must be boolean.');return v;}
function isoNow(){return new Date().toISOString();}
export class GovernanceService {
 constructor(production,advanced){this.prod=production;this.adv=advanced;this.judge=production.judge;this.store=production.store;}
 now(){return this.prod.now();}
 campaign(user,cid,role='viewer'){return this.prod.campaign(user,uuid(cid,'campaign'),role);}
 member(user,wid,role='viewer'){return this.prod.member(user,uuid(wid,'workspace'),role);}
 log(wid,user,kind,detail){this.store.run('INSERT INTO workspace_operational_events(workspace_id,actor_id,kind,payload,created_at) VALUES(?,?,?,?,?)',wid,user,kind,JSON.stringify(detail),this.now());}
 setting(cid){return this.store.one('SELECT require_mapping AS requireMapping FROM campaign_evidence_policy WHERE campaign_id=?',cid)?.requireMapping===1;}
 control(wid){const r=this.store.one('SELECT dispatch_paused AS dispatchPaused,reason,updated_at AS updatedAt FROM workspace_controls WHERE workspace_id=?',wid);return r?{dispatchPaused:!!r.dispatchPaused,reason:r.reason,updatedAt:r.updatedAt}:{dispatchPaused:false,reason:'',updatedAt:null};}
 assertDispatchAllowed(wid){if(this.control(wid).dispatchPaused)throw new DomainError('DISPATCH_PAUSED','Workspace owner has paused all outgoing release transfers.',423);}
 policy(user,cid,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid,'reviewer');this.member(user,c.workspace_id,'owner');expected(body,c);
  const enabled=bool(body.requireMapping,'requireMapping');if(this.setting(cid)===enabled)return this.detail(user,cid);
  this.store.run('INSERT INTO campaign_evidence_policy(campaign_id,require_mapping) VALUES(?,?) ON CONFLICT(campaign_id) DO UPDATE SET require_mapping=excluded.require_mapping',cid,enabled?1:0);
  this.prod.bump(c,user,'creative_trace_policy_changed',{enabled});return this.detail(user,cid);
 });}
 bind(user,cid,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid,'reviewer');expected(body,c);
  const cr=uuid(body.creativeId,'creative'),ev=uuid(body.evidenceId,'evidence');
  const creative=this.store.one('SELECT * FROM campaign_creatives WHERE id=? AND campaign_id=?',cr,cid);
  const evidence=this.store.one('SELECT * FROM campaign_evidence WHERE id=? AND campaign_id=?',ev,cid);
  if(!creative||!evidence||creative.brief_id!==evidence.brief_id)throw new DomainError('TRACE_SCOPE','Evidence must belong to the same campaign and source brief as the creative.',403);
  if(!this.validEvidence(c,evidence))throw new DomainError('EVIDENCE_STALE','Evidence must currently be independently reviewed and unexpired.',409);
  if(this.store.one('SELECT 1 FROM campaign_claim_links WHERE creative_id=? AND evidence_id=?',cr,ev))return this.detail(user,cid);
  this.store.run('INSERT INTO campaign_claim_links(creative_id,evidence_id,created_by,created_at) VALUES(?,?,?,?)',cr,ev,user,this.now());
  this.prod.bump(c,user,'creative_evidence_linked',{creativeId:cr,evidenceId:ev});return this.detail(user,cid);
 });}
 unbind(user,cid,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid,'reviewer');expected(body,c);
  const cr=uuid(body.creativeId,'creative'),ev=uuid(body.evidenceId,'evidence');
  if(!this.store.one('SELECT 1 FROM campaign_creatives WHERE id=? AND campaign_id=?',cr,cid))throw new DomainError('NOT_FOUND','Creative not found.',404);
  const r=this.store.run('DELETE FROM campaign_claim_links WHERE creative_id=? AND evidence_id=?',cr,ev);
  if(!r.changes)throw new DomainError('NOT_FOUND','Evidence mapping not found.',404);
  this.prod.bump(c,user,'creative_evidence_unlinked',{creativeId:cr,evidenceId:ev});return this.detail(user,cid);
 });}
 validEvidence(c,e){return e.review_status==='reviewed'&&e.reviewed_by!==e.created_by&&(!e.expires_at||e.expires_at>=new Date(this.judge.clock()).toISOString().slice(0,10))&&!!this.store.one("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'viewer'",c.workspace_id,e.reviewed_by);}
 issueCreate(user,cid,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid,'reviewer');expected(body,c);
  if(this.store.one('SELECT count(*) AS n FROM campaign_issues WHERE campaign_id=?',cid).n>=100)throw new DomainError('LIMIT','Maximum 100 issues per campaign.',409);
  const severity=body.severity;if(!['critical','major','minor'].includes(severity))throw new DomainError('VALIDATION','Issue severity: critical, major or minor.');
  const title=text(body.title,'Issue title',5,140),details=text(body.details,'Issue details',10,800);
  let creativeId=null;if(body.creativeId){creativeId=uuid(body.creativeId,'creative');if(!this.store.one('SELECT 1 FROM campaign_creatives WHERE id=? AND campaign_id=?',creativeId,cid))throw new DomainError('NOT_FOUND','Creative not in campaign.',404);}
  const issueId=randomUUID();this.store.run('INSERT INTO campaign_issues(id,campaign_id,creative_id,severity,title,details,status,reported_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',issueId,cid,creativeId,severity,title,details,'open',user,this.now());
  this.prod.bump(c,user,'campaign_issue_opened',{issueId,severity});return this.detail(user,cid);
 });}
 issueResolve(user,cid,issueId,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid,'reviewer');expected(body,c);uuid(issueId,'issue');
  const issue=this.store.one('SELECT * FROM campaign_issues WHERE campaign_id=? AND id=?',cid,issueId);
  if(!issue)throw new DomainError('NOT_FOUND','Issue not found.',404);
  if(issue.status!=='open')throw new DomainError('STATE','Issue already resolved.',409);
  if(issue.severity==='critical'&&issue.reported_by===user)throw new DomainError('SEPARATION_OF_DUTIES','A different reviewer must resolve a critical issue.',403);
  const note=text(body.note,'Resolution and supporting reasoning',15,800);
  this.store.run("UPDATE campaign_issues SET status='resolved',resolution_note=?,resolved_by=?,resolved_at=? WHERE id=?",note,user,this.now(),issueId);
  this.prod.bump(c,user,'campaign_issue_resolved',{issueId,severity:issue.severity});return this.detail(user,cid);
 });}
 budget(user,cid,body){return this.store.tx(()=>{
  const c=this.campaign(user,cid);this.member(user,c.workspace_id,'owner');expected(body,c);
  if(!CURRENCIES.has(body.currency))throw new DomainError('VALIDATION','Supported currencies: EUR, USD, SEK, GBP.');
  if(!Number.isSafeInteger(body.capMinor)||body.capMinor<100||body.capMinor>100000000000)throw new DomainError('VALIDATION','Budget cap must be in minor units from 100 to 100000000000.');
  if(!['warn','hold'].includes(body.mode))throw new DomainError('VALIDATION','Use warn or hold.');
  const old=this.store.one('SELECT * FROM campaign_budgets WHERE campaign_id=?',cid);
  if(old&&old.currency===body.currency&&old.cap_minor===body.capMinor&&old.mode===body.mode)return this.detail(user,cid);
  this.store.run('INSERT INTO campaign_budgets(campaign_id,currency,cap_minor,mode,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET currency=excluded.currency,cap_minor=excluded.cap_minor,mode=excluded.mode,updated_by=excluded.updated_by,updated_at=excluded.updated_at',cid,body.currency,body.capMinor,body.mode,user,this.now());
  this.prod.bump(c,user,'budget_policy_updated',{currency:body.currency,capMinor:body.capMinor,mode:body.mode});return this.detail(user,cid);
 });}
 spending(cid){const b=this.store.one('SELECT currency,cap_minor AS capMinor,mode,updated_at AS updatedAt FROM campaign_budgets WHERE campaign_id=?',cid);if(!b)return null;
  const reported=this.store.one("SELECT COALESCE(SUM(spend_minor),0) AS total FROM campaign_observations WHERE campaign_id=? AND currency=? AND retracted_at IS NULL AND source='manual'",cid,b.currency).total;
  return {...b,reportedMinor:reported,exceeded:reported>b.capMinor,disclaimer:'Reported figures are unverified, manually entered; not provider spend.'};}
 controlUpdate(user,wid,body){return this.store.tx(()=>{
  this.member(user,wid,'owner');const paused=bool(body.dispatchPaused,'dispatchPaused'),reason=text(body.reason,'Operator reason',10,300),prior=this.control(wid);
  if(prior.dispatchPaused===paused)throw new DomainError('STATE','Choose a different pause state.',409);
  this.store.run('INSERT INTO workspace_controls(workspace_id,dispatch_paused,reason,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET dispatch_paused=excluded.dispatch_paused,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at',wid,paused?1:0,reason,user,this.now());
  // Once paused, previously issued but unclaimed tokens can never become valid again.
  const revoked=paused?this.store.run("UPDATE release_dispatches SET status='revoked' WHERE status='issued' AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id=?)",wid).changes:0;
  this.log(wid,user,paused?'partner_transfers_paused':'partner_transfers_resumed',{revokedIssued:revoked});
  return {...this.control(wid),revokedUnclaimed:revoked};
 });}
 gate(cid){const c=this.store.one('SELECT * FROM campaigns WHERE id=?',cid);if(!c)return [];
  const reasons=[];
  if(this.setting(cid)){
   const creatives=this.store.all('SELECT id FROM campaign_creatives WHERE campaign_id=?',cid);
   for(const cr of creatives){const links=this.store.all(`SELECT e.* FROM campaign_claim_links l JOIN campaign_evidence e ON e.id=l.evidence_id WHERE l.creative_id=? AND e.campaign_id=?`,cr.id,cid);
     if(!links.some(e=>this.validEvidence(c,e)))reasons.push('UNTRACED_CREATIVE:'+cr.id);
   }
  }
  const issues=this.store.one("SELECT COUNT(*) AS n FROM campaign_issues WHERE campaign_id=? AND severity='critical' AND status='open'",cid).n;
  if(issues)reasons.push('OPEN_CRITICAL_ISSUES:'+issues);
  const spend=this.spending(cid);
  if(spend?.exceeded&&spend.mode==='hold')reasons.push('REPORTED_BUDGET_CAP_EXCEEDED');
  return reasons;
 }
 detail(user,cid){const c=this.campaign(user,cid),issues=this.store.all(`SELECT id,creative_id AS creativeId,severity,title,details,status,reported_by AS reportedBy,resolved_by AS resolvedBy,resolution_note AS resolutionNote,created_at AS createdAt,resolved_at AS resolvedAt FROM campaign_issues WHERE campaign_id=? ORDER BY created_at DESC,id`,cid);
  const traces=this.store.all(`SELECT l.creative_id AS creativeId,l.evidence_id AS evidenceId,e.statement,e.review_status AS reviewStatus,e.expires_at AS expiresAt FROM campaign_claim_links l JOIN campaign_creatives cr ON cr.id=l.creative_id JOIN campaign_evidence e ON e.id=l.evidence_id WHERE cr.campaign_id=?`,cid).map(x=>({...x,valid:this.validEvidence(c,this.store.one('SELECT * FROM campaign_evidence WHERE id=?',x.evidenceId))}));
  const creatives=this.store.all('SELECT id,brief_id AS briefId,channel,language,headline FROM campaign_creatives WHERE campaign_id=?',cid);
  const evidence=this.store.all('SELECT id,brief_id AS briefId,statement,review_status AS reviewStatus FROM campaign_evidence WHERE campaign_id=?',cid);
  return {campaignId:cid,workspaceId:c.workspace_id,revision:c.revision,role:c.role,status:c.status,requireMapping:this.setting(cid),issues,traces,creatives,evidence,budget:this.spending(cid),control:this.control(c.workspace_id),gates:this.gate(cid),releaseCount:this.store.one('SELECT COUNT(*) AS n FROM campaign_releases WHERE campaign_id=?',cid).n,
    note:'Independent review is self-reported. Manual spending is unverified. Internal approval is not legal clearance or external delivery.'};}
 portfolio(user,wid){this.member(user,wid);const campaigns=this.prod.list(user,wid).map(c=>({id:c.id,name:c.name,status:c.status,revision:c.revision,gates:this.prod.preflight(user,c.id).reasons,openCritical:this.store.one("SELECT COUNT(*) AS n FROM campaign_issues WHERE campaign_id=? AND status='open' AND severity='critical'",c.id).n,budget:this.spending(c.id)}));
  return {workspaceId:wid,control:this.control(wid),campaigns,total:campaigns.length,withBlockers:campaigns.filter(x=>x.gates.length).length,releaseCount:this.store.one('SELECT COUNT(*) AS n FROM campaign_releases WHERE campaign_id IN (SELECT id FROM campaigns WHERE workspace_id=?)',wid).n,disclaimer:'Internal workflow diagnostics, not a verified ad platform health status.'};}
 exportUser(user){return {issues:this.store.all('SELECT campaign_id,severity,status,title,details,created_at AS createdAt FROM campaign_issues WHERE reported_by=?',user),
    issueResolutions:this.store.all('SELECT campaign_id,severity,status,resolution_note AS resolutionNote,resolved_at AS resolvedAt FROM campaign_issues WHERE resolved_by=?',user),
    evidenceMappings:this.store.all('SELECT creative_id AS creativeId,evidence_id AS evidenceId,created_at AS createdAt FROM campaign_claim_links WHERE created_by=?',user),
    budgetChanges:this.store.all('SELECT campaign_id,currency,cap_minor AS capMinor,mode,updated_at AS updatedAt FROM campaign_budgets WHERE updated_by=?',user)};}
 cleanupUser(user){
   // Existing workspaces remain operable; erased personal notes cannot silently serve
   // as an independent critical-issue resolution or an evidence attestation.
   const affected=this.store.all(`SELECT DISTINCT c.* FROM campaigns c WHERE c.workspace_id NOT IN
      (SELECT id FROM workspaces WHERE owner_id=?) AND (
       EXISTS(SELECT 1 FROM campaign_claim_links l JOIN campaign_creatives cr ON cr.id=l.creative_id WHERE cr.campaign_id=c.id AND l.created_by=?)
       OR EXISTS(SELECT 1 FROM campaign_issues i WHERE i.campaign_id=c.id AND (i.reported_by=? OR i.resolved_by=?))
       OR EXISTS(SELECT 1 FROM campaign_budgets b WHERE b.campaign_id=c.id AND b.updated_by=?))`,user,user,user,user,user);
   for(const c of affected){
      this.store.run(`DELETE FROM campaign_claim_links WHERE created_by=? AND creative_id IN (SELECT id FROM campaign_creatives WHERE campaign_id=?)`,user,c.id);
      this.store.run("UPDATE campaign_issues SET reported_by=NULL,title='[redacted after account deletion]',details='[redacted after account deletion]' WHERE campaign_id=? AND reported_by=?",c.id,user);
      this.store.run("UPDATE campaign_issues SET status='open',resolved_by=NULL,resolution_note=NULL,resolved_at=NULL WHERE campaign_id=? AND resolved_by=?",c.id,user);
      this.store.run('UPDATE campaign_budgets SET updated_by=NULL WHERE campaign_id=? AND updated_by=?',c.id,user);
      this.prod.bump(c,null,'governance_contributor_erased',{});
   }
   this.store.run("UPDATE workspace_controls SET updated_by=NULL,reason='[redacted after account deletion]' WHERE updated_by=?",user);
   this.store.run('UPDATE workspace_operational_events SET actor_id=NULL WHERE actor_id=?',user);
 }
 exportAudit(user,cid){const c=this.campaign(user,cid,'reviewer');const detail=this.detail(user,cid);const releases=this.store.all('SELECT id,revision,digest,created_at AS createdAt FROM campaign_releases WHERE campaign_id=? ORDER BY revision',cid);
  // This is not a cryptographic signature and does not prove identity or legal compliance.
  const payload={schema:'adverse-governance-audit-1',generatedAt:this.now(),campaign:{id:cid,workspaceId:c.workspace_id,revision:c.revision,status:c.status,name:c.name},
    evidenceTrace:detail.traces,issues:detail.issues,budget:detail.budget,dispatchPaused:detail.control.dispatchPaused,releaseDigests:releases,
    observations:this.adv.measurements(user,cid).totals,preflight:this.prod.preflight(user,cid),
    approvals:this.store.all('SELECT revision,status,requested_by AS requestedBy,reviewer_id AS reviewerId,decided_at AS decidedAt FROM campaign_reviews WHERE campaign_id=? ORDER BY revision',cid),
    disclosures:['Human-reviewed evidence is not fact verification.','Manual spending is self-reported and unverified.','Digest protects the exported file against accidental alterations, not against a malicious exporter.','No external platforms A-G were connected by these waves.']};
  return {sha256:sha(JSON.stringify(payload)),payload};}
}
