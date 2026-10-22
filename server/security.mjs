import { randomBytes, createHash, timingSafeEqual, scrypt, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from '../shared/domain.mjs';
const derive=promisify(scrypt);
export const token=()=>randomBytes(32).toString('base64url');
export const hash=(s)=>createHash('sha256').update(s).digest('hex');
export function equal(a,b) {if (typeof a!=='string'||typeof b!=='string') return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function passwordHash(password) {
  if (typeof password!=='string'||password.length<12||password.length>128) throw new DomainError('PASSWORD','Пароль должен содержать от 12 до 128 символов.');
  const salt=randomBytes(16).toString('hex');
  const key=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password,stored) {
  if (typeof password!=='string'||password.length>128) return false;
  const [,salt,key]=String(stored??'').split(':');
  if (!salt||!key) {await derive(password,'invalid-user-fixed-salt',64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return false;}
  const result=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return equal(result.toString('hex'),key);
}
export function signPayload(payload,secret) {
  if (!secret||secret.length<32) throw new DomainError('CONFIG','Подписание передачи не настроено.',503);
  const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
}
export function verifyPayload(signed,secret,now=Date.now()) {
  if (!secret||secret.length<32||typeof signed!=='string'||signed.length>2000) throw new DomainError('TOKEN','Недействительный токен.',401);
  const [p,s,...rest]=signed.split('.');
  if (rest.length||!p||!s||!equal(createHmac('sha256',secret).update(p).digest('base64url'),s)) throw new DomainError('TOKEN','Недействительный токен.',401);
  let data;try {data=JSON.parse(Buffer.from(p,'base64url').toString());} catch {throw new DomainError('TOKEN','Недействительный токен.',401);}
  if (!Number.isSafeInteger(data.exp)||data.exp<=now||data.v!==1) throw new DomainError('TOKEN_EXPIRED','Срок действия передачи истёк.',410);
  return data;
}
export class Limiter {
  constructor(clock=()=>Date.now()) {this.entries=new Map();this.clock=clock;}
  check(key,limit=80,ms=60000) {
    const now=this.clock();
    if (this.entries.size>10000) for(const [k,v] of this.entries) if(v.until<now) this.entries.delete(k);
    let row=this.entries.get(key);
    if (!row||row.until<=now) {row={n:0,until:now+ms};this.entries.set(key,row);}
    if (++row.n>limit) throw new DomainError('RATE_LIMIT','Слишком много запросов. Повторите чуть позже.',429);
  }
}
/** Coarse device classification; do not store user-supplied raw User-Agent strings. */
export function deviceLabel(raw) {
  const s=typeof raw==='string'?raw.slice(0,512):'';
  const system=/Android/i.test(s)?'Android':/(iPhone|iPad|iPod)/i.test(s)?'iOS':/Windows/i.test(s)?'Windows':/Mac OS X/i.test(s)?'macOS':/Linux/i.test(s)?'Linux':'Неизвестное устройство';
  const browser=/Edg\//i.test(s)?'Edge':/Firefox\//i.test(s)?'Firefox':/Chrome\//i.test(s)?'Chrome':/Safari\//i.test(s)?'Safari':'браузер';
  return `${system} · ${browser}`;
}
