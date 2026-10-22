/** Wave 21 — account proof of control and recovery.
 * An email is NOT verified by typing it into the registration form.
 * No verification token is stored in plaintext or exposed in an API response.
 * An unavailable delivery provider causes fail-closed responses.
 */
import {randomUUID} from 'node:crypto';
import {DomainError} from '../shared/domain.mjs';
import {hash,token,passwordHash} from './security.mjs';
import {validReceiverURL} from './platform-config.mjs';

export function webhookMailer({env=process.env,fetcher=fetch}={}){
 const endpoint=env.JUDGE_MAIL_WEBHOOK_URL,credential=env.JUDGE_MAIL_WEBHOOK_KEY;
 if(!endpoint||!credential)return null;
 if(!validReceiverURL(endpoint)||String(credential).length<20)throw new Error('Mail webhook requires a public HTTPS URL and server-only secret >=20 chars.');
 return async({to,purpose,code})=>{
  const res=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','Authorization':'Bearer '+credential},body:JSON.stringify({to,template:purpose==='verify'?'judge_verify':'judge_recovery',code})});
  if(!res.ok)throw new Error('Mail provider rejected delivery');
 };
}
export class IdentityService {
 constructor(store,{mailer=null,now=()=>Date.now(),requireVerified=false}={}) {this.store=store;this.mailer=mailer;this.now=now;this.requireVerified=requireVerified;}
 status(user){
  const row=this.store.one('SELECT id,email FROM users WHERE id=?',user);
  if(!row)return {registered:false,verified:false,deliveryAvailable:!!this.mailer};
  const verification=this.store.one('SELECT verified_at FROM account_verifications WHERE user_id=?',user);
  return {registered:true,email:row.email,verified:!!verification?.verified_at,verifiedAt:verification?.verified_at||null,deliveryAvailable:!!this.mailer};
 }
 assertVerified(user){
  if(this.requireVerified&&!this.status(user).verified)throw new DomainError('EMAIL_UNVERIFIED','Подтвердите электронную почту для совместной работы.',403);
 }
 async issue(user,purpose){
  if(!this.mailer)throw new DomainError('MAIL_UNAVAILABLE','Провайдер подтверждения почты пока не настроен.',503);
  if(!['verify','reset'].includes(purpose))throw new DomainError('VALIDATION','Unknown challenge purpose.');
  const row=this.store.one('SELECT email FROM users WHERE id=?',user);
  if(!row)return {sent:true}; // generic reset response prevents existence probing
  if(purpose==='verify'&&this.status(user).verified)return {sent:true,alreadyVerified:true};
  const now=this.now(),window=now-3600000;
  const recent=this.store.one('SELECT COUNT(*) AS n FROM email_challenges WHERE user_id=? AND purpose=? AND expires_at>?',user,purpose,window).n;
  if(recent>=5)throw new DomainError('MAIL_RATE_LIMIT','Слишком много запросов. Повторите позже.',429);
  const code=token(),id=randomUUID();
  this.store.tx(()=>{
   this.store.run('UPDATE email_challenges SET revoked_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL AND revoked_at IS NULL',new Date(now).toISOString(),user,purpose);
   this.store.run('INSERT INTO email_challenges(id,user_id,purpose,token_hash,expires_at,issued_at) VALUES(?,?,?,?,?,?)',id,user,purpose,hash(code),now+30*60000,new Date(now).toISOString());
  });
  try{await this.mailer({to:row.email,purpose,code});}
  catch {this.store.run('UPDATE email_challenges SET revoked_at=? WHERE id=?',new Date(this.now()).toISOString(),id);throw new DomainError('MAIL_DELIVERY_FAILED','Письмо не удалось отправить. Попробуйте позже.',503);}
  return {sent:true,expiresInSeconds:1800};
 }
 async requestReset(email){
  if(typeof email!=='string'||email.length>254)return {sent:true};
  const row=this.store.one('SELECT id FROM users WHERE email=?',email.trim().toLowerCase());
  if(!row||!this.mailer)return {sent:true}; // never reveal whether the email exists
  try{await this.issue(row.id,'reset');}catch(e){if(e.code==='MAIL_RATE_LIMIT')return {sent:true};throw e;}
  return {sent:true};
 }
 verify(user,code){
  if(typeof code!=='string'||!/^[a-zA-Z0-9_-]{35,100}$/.test(code))throw new DomainError('TOKEN','Код подтверждения недействителен.',400);
  return this.store.tx(()=>{
   const c=this.store.one('SELECT * FROM email_challenges WHERE token_hash=? AND purpose=?',hash(code),'verify');
   if(!c||c.user_id!==user||c.consumed_at||c.revoked_at||c.expires_at<=this.now())throw new DomainError('TOKEN','Код подтверждения истёк или уже использован.',410);
   const at=new Date(this.now()).toISOString();
   this.store.run('INSERT INTO account_verifications(user_id,verified_at,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at,updated_at=excluded.updated_at',user,at,at);
   this.store.run('UPDATE email_challenges SET consumed_at=? WHERE id=?',at,c.id);
   this.store.run('UPDATE email_challenges SET revoked_at=? WHERE user_id=? AND purpose=? AND id<>? AND consumed_at IS NULL AND revoked_at IS NULL',at,user,'verify',c.id);
   return this.status(user);
  });
 }
 async reset(code,newPassword){
  if(typeof code!=='string'||!/^[a-zA-Z0-9_-]{35,100}$/.test(code))throw new DomainError('TOKEN','Код восстановления недействителен.',400);
  const pw=await passwordHash(newPassword);
  return this.store.tx(()=>{
   const c=this.store.one('SELECT * FROM email_challenges WHERE token_hash=? AND purpose=?',hash(code),'reset');
   if(!c||c.consumed_at||c.revoked_at||c.expires_at<=this.now())throw new DomainError('TOKEN','Код восстановления истёк или уже использован.',410);
   const at=new Date(this.now()).toISOString();
   this.store.run('UPDATE users SET password_hash=? WHERE id=?',pw,c.user_id);
   this.store.run('DELETE FROM sessions WHERE owner_id=?',c.user_id);
   this.store.run('UPDATE email_challenges SET consumed_at=? WHERE id=?',at,c.id);
   this.store.run('UPDATE email_challenges SET revoked_at=? WHERE user_id=? AND purpose=? AND id<>? AND consumed_at IS NULL AND revoked_at IS NULL',at,c.user_id,'reset',c.id);
   return {ok:true,sessionsRevoked:true};
  });
 }
}
