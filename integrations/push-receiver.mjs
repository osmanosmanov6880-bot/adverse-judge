/** Reference receiver for WAVE 24. Demonstrates safe HMAC verification and
 * idempotency over a real HTTP POST. The in-memory receipt map is TEST ONLY:
 * production partners MUST persist receipt identity transactionally. */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const digest=x=>createHash('sha256').update(x).digest('hex');
const KEY=/^judge-[0-9a-f-]{36}$/i;
function eq(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function fail(res,status,message){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({accepted:false,error:message}));}
export function createPushReceiver({secret,receipts=new Map(),onAccepted=async()=>{},maxBody=256*1024}={}){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Receiver requires a separate high-entropy signing key.');
 return async(req,res)=>{
  if(req.method!=='POST')return fail(res,405,'POST required');
  const key=req.headers['x-adverse-idempotency-key'],claimed=req.headers['x-adverse-body-sha256'],signature=req.headers['x-adverse-signature'];
  if(typeof key!=='string'||!KEY.test(key)||typeof claimed!=='string'||!/^[a-f0-9]{64}$/.test(claimed)||typeof signature!=='string'||!/^v1=[a-f0-9]{64}$/.test(signature))return fail(res,401,'Invalid signed request');
  let size=0;const chunks=[];
  try{for await(const c of req){size+=c.length;if(size>maxBody)return fail(res,413,'Payload too large');chunks.push(c);}}
  catch{return fail(res,400,'Invalid request body');}
  const raw=Buffer.concat(chunks).toString('utf8'),sha=digest(raw),mac='v1='+createHmac('sha256',secret).update(key+'\n'+sha).digest('hex');
  if(!eq(claimed,sha)||!eq(signature,mac))return fail(res,401,'Signature verification failed');
  let body;try{body=JSON.parse(raw);}catch{return fail(res,400,'Malformed JSON');}
  if(body?.schema!=='adverse-release-push-1'||typeof body.dispatchId!=='string'||typeof body.releaseId!=='string'||typeof body.sha256!=='string'||body.package?.schema!=='adverse-editorial-release-1'||body.package?.id!==body.releaseId||body.package?.sha256!==body.sha256||body.package?.deliveryConfirmed!==false)return fail(res,422,'Invalid release envelope');
  const {id,sha256:_,deliveryConfirmed,...payload}=body.package;
  if(digest(JSON.stringify(payload))!==body.sha256)return fail(res,422,'Invalid release digest');
  const prior=receipts.get(key);
  if(prior){if(prior.digest!==sha)return fail(res,409,'Idempotency key conflicts with another package');return accept(res,key,true);}
  try{await onAccepted({idempotencyKey:key,dispatchId:body.dispatchId,releaseId:body.releaseId,sha256:body.sha256,package:body.package});}
  catch{return fail(res,503,'Receiver storage unavailable');}
  receipts.set(key,{digest:sha,receivedAt:new Date().toISOString()});
  return accept(res,key,false);
 };
}
function accept(res,key,duplicate){res.writeHead(202,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({accepted:true,idempotencyKey:key,duplicate}));}
