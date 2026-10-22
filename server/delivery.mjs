/** Wave 24: durable server-controlled release outbox.
 * HTTP acceptance means the partner received a package, NOT that an ad was
 * published or generated. Only authenticated callbacks confirm useful actions.
 */
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {DomainError} from '../shared/domain.mjs';
import {validReceiverURL,integrationReadiness} from './platform-config.mjs';
import {hash} from './security.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const idPattern=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
function validEndpoint(value,allowLocal=false){
 if(validReceiverURL(value))return true;
 if(!allowLocal)return false;
 try {const u=new URL(value);return u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.hash;}catch{return false;}
}
export class DeliveryService{
 constructor(advanced,{fetcher=fetch,clock=()=>Date.now(),env=process.env,allowLoopbackTest=false}={}){
  this.adv=advanced;this.prod=advanced.prod;this.store=advanced.store;this.fetcher=fetcher;this.clock=clock;this.env={...process.env,...env};this.allowLoopbackTest=allowLoopbackTest;
 }
 platform(id){const p=this.adv.judge.platforms.find(p=>p.id===id);
  if(!p||p.mode!=='api'||!p.verified||!validEndpoint(p.deliveryUrl,this.allowLoopbackTest)||!p.deliveryKeyEnv||!(this.env[p.deliveryKeyEnv]?.length>=32)||!p.credentialEnv||!(this.env[p.credentialEnv]?.length>=20)||!this.adv.judge.secret||this.adv.judge.secret.length<32)
   throw new DomainError('PLATFORM_NOT_CONFIGURED','Verified API delivery contract and separate secrets required.',503);
  return p;
 }
 enqueue(user,cid,dispatchId){return this.store.tx(()=>{
   const c=this.prod.campaign(user,cid,'reviewer');
   if(typeof dispatchId!=='string'||!idPattern.test(dispatchId))throw new DomainError('VALIDATION','Invalid dispatch ID.');
   const d=this.store.one('SELECT * FROM release_dispatches WHERE id=? AND campaign_id=?',dispatchId,cid);
   if(!d)throw new DomainError('NOT_FOUND','Dispatch does not belong to this campaign.',404);
   const old=this.store.one('SELECT * FROM delivery_queue WHERE dispatch_id=?',dispatchId);
   if(old)return {id:old.id,status:old.status,duplicate:true};
   if(d.status!=='issued'||d.expires_at<=this.clock())throw new DomainError('STATE','Only an unexpired issued dispatch can be queued.',409);
   const p=this.platform(d.platform_id),ready=this.prod.preflight(user,cid);
   if(!ready.ready||c.status!=='approved'||c.revision!==this.store.one('SELECT revision FROM campaign_releases WHERE id=?',d.release_id).revision)throw new DomainError('PREFLIGHT','Only the current approved release can be queued.',409);
   this.adv.governance?.assertDispatchAllowed(c.workspace_id);
   this.prod.exportRelease(user,cid,d.release_id); // source access must remain valid
   const id=randomUUID(),at=this.prod.now();
   this.store.run(`INSERT INTO delivery_queue(id,dispatch_id,platform_id,endpoint,status,attempts,next_attempt_at,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?)`,id,dispatchId,p.id,p.deliveryUrl,'queued',0,this.clock(),at,at,'judge-'+id);
   this.adv.event(cid,user,'partner_delivery_queued',{queueId:id,dispatchId,platformId:p.id});
   return {id,status:'queued',duplicate:false};
  });}
 list(user,cid){this.prod.campaign(user,cid);return this.store.all(`SELECT q.id,q.dispatch_id AS dispatchId,q.platform_id AS platformId,q.status,q.attempts,q.next_attempt_at AS nextAttemptAt,q.last_http_status AS lastHttpStatus,q.last_error AS lastError,q.created_at AS createdAt FROM delivery_queue q JOIN release_dispatches d ON d.id=q.dispatch_id WHERE d.campaign_id=? ORDER BY q.created_at DESC LIMIT 100`,cid);}
 async attempt(user,cid,qid,{system=false}={}){
  if(typeof qid!=='string'||!idPattern.test(qid))throw new DomainError('VALIDATION','Invalid queue ID.');
  const queue=this.store.one('SELECT * FROM delivery_queue WHERE id=?',qid);
  if(!queue)throw new DomainError('NOT_FOUND','Queue item not found.',404);
  const dispatch=this.store.one('SELECT * FROM release_dispatches WHERE id=?',queue.dispatch_id);
  if(!dispatch||dispatch.campaign_id!==cid)throw new DomainError('NOT_FOUND','Queue item does not belong to campaign.',404);
  const c=this.prod.campaign(user,cid,system?'viewer':'owner');
  if(queue.status==='accepted')return {id:qid,status:'accepted',duplicate:true};
  if(!['queued','retry','sending'].includes(queue.status))throw new DomainError('STATE','Item is no longer retryable.',409);
  if(queue.next_attempt_at>this.clock())throw new DomainError('BACKOFF','Next delivery attempt is not due.',409);
  // All invariant checks run immediately before issuing the network request.
  const p=this.platform(queue.platform_id);
  if(p.deliveryUrl!==queue.endpoint)throw new DomainError('ENDPOINT_CHANGED','Partner endpoint changed; the old queue must not follow it.',409);
  let release,releasePayload;
  try {
   if(dispatch.status!=='issued'||dispatch.expires_at<=this.clock())throw new DomainError('STATE','Dispatch no longer available.',409);
   if(c.status!=='approved'||c.revision!==this.store.one('SELECT revision FROM campaign_releases WHERE id=?',dispatch.release_id)?.revision)throw new DomainError('STALE_RELEASE','Release changed.',409);
   if(!this.prod.preflight(user,cid).ready)throw new DomainError('PREFLIGHT','Campaign no longer passes preflight.',409);
   this.adv.governance?.assertDispatchAllowed(c.workspace_id);
   release=this.store.one('SELECT * FROM campaign_releases WHERE id=?',dispatch.release_id);
   releasePayload=this.prod.exportRelease(user,cid,release.id);
  } catch(e) {
   this.store.run("UPDATE delivery_queue SET status='cancelled',last_error=?,updated_at=? WHERE id=?",e.code||'REVOKED',this.prod.now(),qid);
   this.store.run("UPDATE release_dispatches SET status='revoked' WHERE id=? AND status='issued'",dispatch.id);
   throw e;
  }
  const claimed=this.store.tx(()=>{
   const row=this.store.one('SELECT status,next_attempt_at,attempts FROM delivery_queue WHERE id=?',qid);
   if(!['queued','retry','sending'].includes(row.status)||row.next_attempt_at>this.clock())throw new DomainError('LEASED','Another attempt is in progress.',409);
   const at=this.prod.now();
   this.store.run("UPDATE delivery_queue SET status='sending',attempts=attempts+1,next_attempt_at=?,updated_at=? WHERE id=?",this.clock()+30000,at,qid);
   return row.attempts+1;
  });
  const body=JSON.stringify({schema:'adverse-release-push-1',dispatchId:dispatch.id,releaseId:release.id,sha256:release.digest,package:releasePayload}),bodyDigest=sha(body);
  const signature='v1='+createHmac('sha256',this.env[p.deliveryKeyEnv]).update(queue.idempotency_key+'\n'+bodyDigest).digest('hex');
  let status=0,accepted=false,error='';
  try {
   const response=await this.fetcher(queue.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-ADVERSE-Idempotency-Key':queue.idempotency_key,'X-ADVERSE-Body-SHA256':bodyDigest,'X-ADVERSE-Signature':signature},body});
   status=response.status;
   if(status===200||status===202){
    const result=await response.json();
    accepted=result?.accepted===true&&result.idempotencyKey===queue.idempotency_key;
    if(!accepted)error='BAD_PARTNER_ACK';
   }else error='HTTP_'+status;
  }catch{error='NETWORK_ERROR';}
  return this.store.tx(()=>{
   const row=this.store.one('SELECT status FROM delivery_queue WHERE id=?',qid);
   if(row.status!=='sending')throw new DomainError('LEASED','Delivery state changed during network request.',409);
   // The sender can revoke the token while the HTTP request is in flight. The
   // remote party MAY still have received it, but JUDGE must not label a
   // revoked dispatch as accepted or let an old lease silently redeem it.
   const nowDispatch=this.store.one('SELECT status FROM release_dispatches WHERE id=?',dispatch.id);
   const nowCampaign=this.store.one('SELECT revision,status FROM campaigns WHERE id=?',cid);
   if(nowDispatch?.status!=='issued'||nowCampaign?.status!=='approved'||nowCampaign?.revision!==release.revision){
    this.store.run("UPDATE delivery_queue SET status='failed',last_error='REVOKED_DURING_SEND_PARTNER_MAY_HAVE_RECEIVED',last_http_status=?,updated_at=? WHERE id=?",status||null,this.prod.now(),qid);
    this.adv.event(cid,null,'delivery_outcome_uncertain',{queueId:qid,dispatchId:dispatch.id,remoteAcknowledged:accepted});
    return {id:qid,status:'failed',attempts:claimed,partnerAccepted:accepted,confirmedAdAction:false,outcomeUncertain:true};
   }
   let next,backoff=0;
   if(accepted){next='accepted';this.store.run("UPDATE release_dispatches SET status='redeemed',redeemed_at=?,redeem_request_hash=? WHERE id=? AND status='issued'",this.prod.now(),hash(p.id+':'+queue.idempotency_key),dispatch.id);
     this.adv.event(cid,null,'delivery_accepted_by_partner',{queueId:qid,dispatchId:dispatch.id,platformId:p.id});
   }else{
    const transient=!status||status===408||status===429||status>=500;
    next=transient&&claimed<5?'retry':'failed';backoff=Math.min(3600000,Math.pow(2,claimed)*15000);
   }
   this.store.run('UPDATE delivery_queue SET status=?,next_attempt_at=?,last_http_status=?,last_error=?,updated_at=? WHERE id=?',next,this.clock()+backoff,status||null,error||null,this.prod.now(),qid);
   return {id:qid,status:next,attempts:claimed,httpStatus:status||null,partnerAccepted:accepted,confirmedAdAction:false,nextAttemptAt:next==='retry'?this.clock()+backoff:null};
  });
 }
 async runDue({limit=10}={}){const ids=this.store.all("SELECT q.id,d.campaign_id AS campaignId,c.workspace_id AS workspaceId FROM delivery_queue q JOIN release_dispatches d ON d.id=q.dispatch_id JOIN campaigns c ON c.id=d.campaign_id WHERE (q.status='queued' OR q.status='retry' OR q.status='sending') AND q.next_attempt_at<=? ORDER BY q.next_attempt_at LIMIT ?",this.clock(),Math.min(20,Math.max(1,limit)));
  const results=[];for(const x of ids){const owner=this.store.one("SELECT user_id FROM workspace_members WHERE workspace_id=? AND role='owner'",x.workspaceId);
   if(!owner){results.push({id:x.id,status:'owner_missing'});continue;}
   try{results.push(await this.attempt(owner.user_id,x.campaignId,x.id,{system:true}));}catch(e){results.push({id:x.id,error:e.code||'INTERNAL'});}}
  return results;
 }
}
