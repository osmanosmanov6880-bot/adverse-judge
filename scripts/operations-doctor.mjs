/** Local operational assessment. Outputs no secrets or user claims. */
import {existsSync,statSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validatePlatformManifest,integrationReadiness} from '../server/platform-config.mjs';
import {modelStatus} from '../server/llm.mjs';
import {verifyDatabase} from './verify-db.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function operationsDoctor({env=process.env,root=ROOT}={}){
 const checks=[];
 const check=(id,ok,message,severity='warning')=>checks.push({id,status:ok?'pass':severity,message});
 const [major,minor]=process.versions.node.split('.').map(Number);
 check('node',(major>22||(major===22&&minor>=13)),'Node.js >=22.13 is required','blocker');
 let origin;
 try{origin=new URL(env.APP_ORIGIN??'http://localhost:3000');check('origin',origin.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(origin.hostname),'Public deployments require HTTPS','blocker');}
 catch{check('origin',false,'APP_ORIGIN is invalid','blocker');}
 const manifestPath=resolve(env.JUDGE_PLATFORMS_FILE??resolve(root,'config/platforms.json'));
 let manifest=[],configured=0;
 try{manifest=validatePlatformManifest(JSON.parse(readFileSync(manifestPath,'utf8')));const readiness=manifest.map(x=>integrationReadiness(x,{env,secret:env.HANDOFF_SECRET||''}));configured=readiness.filter(x=>x.configured).length;check('manifest',manifest.length===7,'Expected A-G manifest entries');}
 catch{check('manifest',false,'Manifest missing or invalid','blocker');}
 const dbPath=resolve(env.JUDGE_DB??resolve(root,'data/judge.sqlite'));
 if(existsSync(dbPath)){
  try{const report=verifyDatabase(dbPath);check('database',report.ok,'Database integrity and exact event replay','blocker');
   const mode=statSync(dbPath).mode&0o777;check('database-permissions',(mode&0o077)===0,'SQLite file permissions must exclude group/other access');}
  catch{check('database',false,'Database could not be read or verified','blocker');}
 }else check('database',false,'Database is not created yet. Start local server and create a case.');
 check('backup-policy',false,'Automated encrypted off-machine backup and restore drills are not configured');
 check('email-identity',false,'Email verification, recovery, MFA and shared SSO have not been implemented');
 check('production-data',false,'Retention schedule, data processor agreements and DSAR operations require operator review');
 check('comparison-fraud-controls',false,'Blind tests have single-use links but no email verification, anti-Sybil detection or bot challenges');
 check('platform-e2e',configured===7,`Platform manifests configured: ${configured}/7. Live partner acceptance remains separately required.`);
 check('ledger-key',Boolean(env.JUDGE_LEDGER_SECRET&&env.JUDGE_LEDGER_SECRET.length>=32),'Set a protected, persistent JUDGE_LEDGER_SECRET before the first deployment. Unkeyed SHA256 is not adversary-resistant.');
 const ai=modelStatus(env);
 return {schema:'judge-operations-v025',version:'0.25.0',deploymentClassification:'local-pilot-or-private-staging',productionReady:false,
  sqlite:existsSync(dbPath),integrationsContractReady:configured,integrationsTotal:manifest.length,
  remoteAIConfigured:ai.enabled,checks,
  strictStagingCandidate:origin?.protocol==='https:'&&!checks.some(c=>c.status==='blocker'),
  note:'Diagnostic cannot verify reverse proxy authentication, TLS delivery, backups, live integrations or legal compliance. ProductionReady is always false for this release.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const report=operationsDoctor();console.log(JSON.stringify(report,null,2));
 if(process.argv.includes('--strict-staging')&&!report.strictStagingCandidate)process.exitCode=1;
}
