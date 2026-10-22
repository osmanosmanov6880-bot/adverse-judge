/** Offline editorial release integrity checker. The SHA protects against accidental
 * modifications, not adversarial replacement or unauthorized platform delivery. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export function verifyReleaseObject(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:'FORMAT'};
  const {id,sha256,deliveryConfirmed,...payload}=input;
  if(!/^[0-9a-f]{64}$/.test(sha256??''))return {ok:false,error:'HASH_FORMAT'};
  if(payload.schema!=='adverse-editorial-release-1'||!Array.isArray(payload.briefs)||!Array.isArray(payload.creatives)||!Array.isArray(payload.evidence))return {ok:false,error:'SCHEMA'};
  if(deliveryConfirmed!==false)return {ok:false,error:'UNVERIFIED_DELIVERY'};
  const actual=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {ok:actual===sha256,format:payload.schema,digestMatches:actual===sha256,declaresExternalDelivery:false,creatives:payload.creatives.length,briefs:payload.briefs.length,evidence:payload.evidence.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(!process.argv[2])throw Error('Usage: npm run release:verify -- <exported JSON file>');
    const report=verifyReleaseObject(JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')));
    console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
  }catch(error){console.error('Release verification failed:',error.message);process.exitCode=1;}
}
