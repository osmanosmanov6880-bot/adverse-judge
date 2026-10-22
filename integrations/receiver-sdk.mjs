/** ADVERSE JUDGE: receiving-platform SERVER-ONLY contract adapter.
 * Never import this module into a browser bundle or expose its credential.
 * Caller must persist requestId/eventId in its own DB, together with business action.
 */
import {isIP} from 'node:net';

export class JudgePartnerError extends Error {
  constructor(code,status,message){super(message);this.name='JudgePartnerError';this.code=code;this.status=status;}
}
export function validateJudgeOrigin(raw,{allowLoopbackTests=false}={}){
  if(typeof raw!=='string')throw new JudgePartnerError('CONFIG',0,'Judge origin is required');
  let u;try{u=new URL(raw);}catch{throw new JudgePartnerError('CONFIG',0,'Judge origin is invalid');}
  const loopback=(u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.hostname==='[::1]');
  if(u.username||u.password||u.hash||u.search||u.pathname!=='/'||!['https:','http:'].includes(u.protocol)||
     (u.protocol==='http:'&&!(loopback&&allowLoopbackTests))||
     (u.protocol==='https:'&&(loopback||!u.hostname.includes('.')||isIP(u.hostname)))){
    throw new JudgePartnerError('CONFIG',0,'Judge origin must be a public HTTPS origin, or an explicit loopback test');
  }
  return u.origin;
}
export function createJudgeReceiver({judgeOrigin,platformId,credential,fetcher=globalThis.fetch,allowLoopbackTests=false,timeoutMs=8000}={}){
  const origin=validateJudgeOrigin(judgeOrigin,{allowLoopbackTests});
  if(!/^[A-Z][A-Z0-9_-]{0,31}$/.test(platformId??''))throw new JudgePartnerError('CONFIG',0,'Invalid platform ID');
  if(typeof credential!=='string'||credential.length<20)throw new JudgePartnerError('CONFIG',0,'Credential is missing');
  if(typeof fetcher!=='function')throw new JudgePartnerError('CONFIG',0,'fetcher is required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw new JudgePartnerError('CONFIG',0,'Invalid timeout');
  async function post(path,body){
    let response;
    try{response=await fetcher(origin+path,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(timeoutMs),
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+credential,'Accept':'application/json'},
      body:JSON.stringify({platformId,...body})
    });}catch{throw new JudgePartnerError('NETWORK',0,'Judge request failed; retry with the SAME persisted idempotency key');}
    // Intentionally reject redirects (never forward bearer tokens to a redirect).
    if(response.status>=300&&response.status<400)throw new JudgePartnerError('REDIRECT',response.status,'Judge redirect is prohibited');
    let data;
    try{
      const raw=await response.text();if(raw.length>131072)throw Error('oversized');data=JSON.parse(raw);
    }catch{throw new JudgePartnerError('PROTOCOL',response.status,'Invalid Judge response');}
    if(!response.ok)throw new JudgePartnerError(data?.error?.code||'REMOTE_ERROR',response.status,data?.error?.message||'Judge request declined');
    return data;
  }
  return Object.freeze({
    async redeem({token,requestId}){
      if(typeof token!=='string'||token.length>2000||!token.includes('.'))throw new JudgePartnerError('INPUT',0,'Invalid token');
      if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw new JudgePartnerError('INPUT',0,'A stable requestId is required');
      const data=await post('/api/integrations/redeem',{token,requestId});
      if(typeof data.handoffId!=='string'||!data.brief||typeof data.brief!=='object')throw new JudgePartnerError('PROTOCOL',200,'Invalid redeem response');
      return data;
    },
    async confirm({handoffId,eventId,action}){
      if(typeof handoffId!=='string'||handoffId.length>100||typeof eventId!=='string'||eventId.length<8||eventId.length>100||typeof action!=='string'||!/^([a-z][a-z0-9_]{2,63})$/.test(action))
        throw new JudgePartnerError('INPUT',0,'Invalid confirmation fields');
      const data=await post('/api/integrations/events',{handoffId,eventId,action});
      if(data.ok!==true||typeof data.duplicate!=='boolean')throw new JudgePartnerError('PROTOCOL',200,'Invalid confirmation response');
      return data;
    }
  });
}
