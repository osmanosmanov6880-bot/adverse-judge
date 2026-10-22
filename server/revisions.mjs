/** Wave 22: compare immutable releases with current editable campaign and
 * rehydrate a historical creative set as a NEW DRAFT revision.
 * Restoring does not restore approval, evidence attestations, or permission.
 */
import {randomUUID,createHash} from 'node:crypto';
import {DomainError} from '../shared/domain.mjs';
import {checkCreative} from './production.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const key=x=>JSON.stringify([x.channel,x.language,x.headline,x.body,x.cta]);
const counts=list=>{const m=new Map();for(const x of list)m.set(key(x),(m.get(key(x))||0)+1);return m;};
export class RevisionService {
 constructor(production){this.prod=production;this.store=production.store;}
 release(user,cid,rid){this.prod.campaign(user,cid);if(typeof rid!=='string'||!uuid.test(rid))throw new DomainError('VALIDATION','Invalid release ID');
  const row=this.store.one('SELECT * FROM campaign_releases WHERE id=? AND campaign_id=?',rid,cid);
  if(!row)throw new DomainError('NOT_FOUND','Release does not belong to this campaign.',404);
  if(sha(row.payload)!==row.digest)throw new DomainError('INTEGRITY','Release digest mismatch.',409);
  const payload=JSON.parse(row.payload);
  if(payload.schema!=='adverse-editorial-release-1'||!Array.isArray(payload.creatives)||!Array.isArray(payload.briefs))throw new DomainError('INTEGRITY','Unsupported release schema.',409);
  return {row,payload};
 }
 compare(user,cid,rid){const c=this.prod.campaign(user,cid),{row,payload}=this.release(user,cid,rid);
  const current=this.store.all('SELECT channel,language,headline,body,cta FROM campaign_creatives WHERE campaign_id=?',cid),a=counts(payload.creatives),b=counts(current),added=[],removed=[];
  for(const [k,n] of b)for(let j=0;j<n-(a.get(k)||0);j++)added.push(Object.fromEntries(["channel","language","headline","body","cta"].map((x,i)=>[x,JSON.parse(k)[i]])));
  for(const [k,n] of a)for(let j=0;j<n-(b.get(k)||0);j++)removed.push(Object.fromEntries(["channel","language","headline","body","cta"].map((x,i)=>[x,JSON.parse(k)[i]])));
  const briefStatuses=payload.briefs.map(item=>{
   const now=this.store.one('SELECT verdict_id FROM campaign_briefs WHERE campaign_id=? AND case_id=?',cid,item.caseId);
   let available=false;
   try {const src=this.prod.source(c,item.caseId); available=src.state.verdictId===item.verdictId;}catch{}
   return {caseId:item.caseId,historicalVerdictId:item.verdictId,exists:!!now,stillCurrent:!!now&&now.verdict_id===item.verdictId&&available};
  });
  return {releaseId:row.id,releaseRevision:row.revision,currentRevision:c.revision,releaseSha256:row.digest,
   added,removed,unchanged:Math.max(0,current.length-added.length),
   goalChanged:c.objective!==payload.campaign.objective,audienceChanged:c.audience!==payload.campaign.audience,
   briefStatuses,canRestore:briefStatuses.length===1&&briefStatuses.every(x=>x.stillCurrent)&&payload.creatives.length<=100&&payload.creatives.length>0,
   disclaimer:'Only editable copy can be restored. Approval, claim proof, and confirmed delivery are never restored.'};
 }
 restore(user,cid,rid,{expectedRevision,acknowledged}={}){
  return this.store.tx(()=>{
   const c=this.prod.campaign(user,cid,'reviewer');
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==c.revision)throw new DomainError('VERSION_CONFLICT','Campaign changed; refresh before restoring.',409);
   if(acknowledged!==true)throw new DomainError('ACK_REQUIRED','Acknowledge that a restored draft requires fresh approval.');
   if(c.status==='archived')throw new DomainError('STATE','Archived campaign is read-only.',409);
   const cmp=this.compare(user,cid,rid);
   if(!cmp.canRestore)throw new DomainError('SOURCE_STALE','Historical briefs need renewed sharing and current verdicts before copy can be restored.',409);
   const {payload}=this.release(user,cid,rid);
   const prior=this.store.all('SELECT id,brief_id AS briefId,channel,language,headline,body,cta FROM campaign_creatives WHERE campaign_id=?',cid),byCase=new Map();
   for(const b of this.store.all('SELECT id,case_id FROM campaign_briefs WHERE campaign_id=?',cid))byCase.set(b.case_id,b.id);
   // Older releases do not embed per-creative brief IDs. We can restore only
   // when the historical release has exactly one uniquely current brief.
   if(payload.briefs.length!==1)throw new DomainError('AMBIGUOUS_BRIEF','Restoring copy requires a release with exactly one source brief.',409);
   const bid=byCase.get(payload.briefs[0].caseId);if(!bid)throw new DomainError('SOURCE_STALE','Source brief no longer present.',409);
   for(const creative of payload.creatives)checkCreative(creative);
   this.store.run('DELETE FROM campaign_creatives WHERE campaign_id=?',cid);
   for(const creative of payload.creatives){const v=checkCreative(creative);
    this.store.run('INSERT INTO campaign_creatives VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),cid,bid,v.channel,v.language,v.headline,v.body,v.cta,user,this.prod.now());
   }
   this.prod.bump(c,user,'creative_revision_restored',{fromRelease:rid,sourceRevision:cmp.releaseRevision,items:payload.creatives.length});
   this.store.run('INSERT INTO creative_revision_snapshots VALUES(?,?,?,?,?,?,?,?)',randomUUID(),cid,rid,c.revision,c.revision+1,JSON.stringify(prior),user,this.prod.now());
   return {restored:true,fromRelease:rid,newRevision:c.revision+1,creatives:payload.creatives.length,approvalRequired:true};
  });
 }
}
