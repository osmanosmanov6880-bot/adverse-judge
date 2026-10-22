/** Offline checksum validation for an internal editorial audit bundle.
 * It is NOT a signed attestation, legal review, or independent source verification.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export function verifyGovernance(bundle){
 if(!bundle||typeof bundle!=='object'||!bundle.payload||bundle.payload.schema!=='adverse-governance-audit-1')return {ok:false,reason:'SCHEMA_MISMATCH'};
 if(typeof bundle.sha256!=='string'||!/^[0-9a-f]{64}$/.test(bundle.sha256))return {ok:false,reason:'DIGEST_MISSING'};
 const digest=createHash('sha256').update(JSON.stringify(bundle.payload)).digest('hex');
 if(bundle.sha256!==digest)return {ok:false,reason:'SHA256_MISMATCH'};
 if(!Array.isArray(bundle.payload.disclosures)||!Array.isArray(bundle.payload.releaseDigests))return {ok:false,reason:'STRUCTURE_INVALID'};
 if(bundle.payload.releaseDigests.some(x=>!/^[0-9a-f]{64}$/.test(x.digest)))return {ok:false,reason:'RELEASE_DIGEST_FORMAT_INVALID'};
 return {ok:true,sha256:digest,campaignId:bundle.payload.campaign?.id,disclaimer:'This only verifies the internal export file has not been modified after its checksum was made; it does not authenticate the exporter.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv[2];if(!file){console.error('Usage: npm run audit:verify -- exported-audit.json');process.exit(2);}
 try {const result=verifyGovernance(JSON.parse(readFileSync(resolve(file),'utf8')));console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
 catch(e){console.error('Audit file cannot be parsed or opened.');process.exitCode=1;}
}
