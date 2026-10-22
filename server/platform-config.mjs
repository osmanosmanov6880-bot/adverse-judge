/** Operator-controlled integration configuration, no secrets exposed. */
import {isIP} from 'node:net';
import {DomainError} from '../shared/domain.mjs';
const MODES=new Set(['clipboard','deeplink','api']);
const EVENT=/^[a-z][a-z0-9_]{2,63}$/;
export function validReceiverURL(raw){
  if(typeof raw!=='string'||raw.length>1024)return false;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')return false;
    const host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')||isIP(host))return false;
    return true;
  }catch{return false;}
}
export function validatePlatformManifest(platforms){
  if(!Array.isArray(platforms)||platforms.length>32)throw new DomainError('CONFIG','Неверный список рекламных платформ.',503);
  const seen=new Set();
  for(const p of platforms){
    if(!p||typeof p!=='object'||!/^([A-Z]|[A-Z][A-Z0-9_-]{1,31})$/.test(p.id??'')||seen.has(p.id))throw new DomainError('CONFIG','Повторяющийся или некорректный идентификатор платформы.',503);
    seen.add(p.id);
    if(!MODES.has(p.mode))throw new DomainError('CONFIG',`Платформа ${p.id}: неизвестный тип интеграции.`,503);
    if(p.url!=null&&!validReceiverURL(p.url))throw new DomainError('CONFIG',`Платформа ${p.id}: требуется безопасный публичный HTTPS URL.`,503);
    if(p.deliveryUrl!=null&&!validReceiverURL(p.deliveryUrl))throw new DomainError('CONFIG',`Platform ${p.id}: valid public HTTPS deliveryUrl is required.`,503);
    if(p.deliveryKeyEnv!=null&&!/^[A-Z][A-Z0-9_]{2,99}$/.test(p.deliveryKeyEnv))throw new DomainError('CONFIG',`Platform ${p.id}: invalid delivery key environment variable.`,503);
    if(p.credentialEnv!=null&&!/^[A-Z][A-Z0-9_]{2,99}$/.test(p.credentialEnv))throw new DomainError('CONFIG',`Платформа ${p.id}: неверное имя переменной секрета.`,503);
    if(p.confirmedEvents!=null&&(!Array.isArray(p.confirmedEvents)||p.confirmedEvents.length>20||p.confirmedEvents.some(x=>typeof x!=='string'||!EVENT.test(x))||new Set(p.confirmedEvents).size!==p.confirmedEvents.length))throw new DomainError('CONFIG',`Платформа ${p.id}: некорректные названия подтверждаемых событий.`,503);
    if(p.verified===true&&p.mode==='deeplink'&&(!p.url||!p.credentialEnv))throw new DomainError('CONFIG',`Платформа ${p.id}: подтверждённое подключение требует адрес и секрет.`,503);
  }
  return platforms;
}
export function integrationReadiness(p,{env=process.env,secret=''}={}){
  const reasons=[];
  if(p.mode==='clipboard')reasons.push('Только ручной экспорт');
  else if(p.mode==='api') {
    if(!p.verified)reasons.push('Partner contract has not been verified by the operator');
    if(!validReceiverURL(p.deliveryUrl))reasons.push('Verified public HTTPS deliveryUrl missing');
    if(!p.deliveryKeyEnv||!env[p.deliveryKeyEnv]||String(env[p.deliveryKeyEnv]).length<32)reasons.push('Separate server-side delivery signing key missing (>=32 chars)');
    if(!p.credentialEnv||!env[p.credentialEnv]||String(env[p.credentialEnv]).length<20)reasons.push('Partner callback credential missing');
    if(typeof secret!=='string'||secret.length<32)reasons.push('Server dispatch signing secret missing');
    if(!Array.isArray(p.confirmedEvents)||!p.confirmedEvents.length)reasons.push('Verified confirmation event contract missing');
  } else {
    if(!p.verified)reasons.push('Контракт не подтверждён оператором');
    if(!validReceiverURL(p.url))reasons.push('Не задан проверенный HTTPS адрес');
    if(!p.credentialEnv||!env[p.credentialEnv]||String(env[p.credentialEnv]).length<20)reasons.push('Нет отдельного серверного секрета платформы (от 20 символов)');
    if(typeof secret!=='string'||secret.length<32)reasons.push('Нет серверного секрета подписания (от 32 символов)');
    if(!Array.isArray(p.confirmedEvents)||p.confirmedEvents.length===0)reasons.push('Нет согласованного списка подтверждаемых действий');
  }
  const configured=(p.mode==='deeplink'||p.mode==='api')&&reasons.length===0;
  return {id:p.id,name:p.name||`Платформа ${p.id}`,mode:p.mode,verified:p.verified===true,configured,status:configured?'contract_ready_not_live_verified':'not_configured',reasons};
}
