/** Safe operator assessment of A-G, without printing secrets or credentials. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {validatePlatformManifest,integrationReadiness} from '../server/platform-config.mjs';
const filename=process.env.JUDGE_PLATFORMS_FILE||'config/platforms.json';
const manifest=validatePlatformManifest(JSON.parse(readFileSync(filename,'utf8')));
const ids='ABCDEFG'.split('');
const status=manifest.map(p=>integrationReadiness(p,{secret:process.env.HANDOFF_SECRET||''}));
const duplicates=manifest.filter(p=>p.credentialEnv).map(p=>p.credentialEnv);
const report={schema:'adverse-integration-audit-v1',builtAt:new Date().toISOString(),
  expectedPlatforms:ids,presentIds:manifest.map(p=>p.id),
  missingIds:ids.filter(id=>!manifest.some(x=>x.id===id)),
  repeatedCredentialVars:duplicates.filter((x,i)=>duplicates.indexOf(x)!==i),
  partners:status.map(p=>({id:p.id,mode:p.mode,verified:p.verified,configured:p.configured,status:p.status,reasons:p.reasons})),
  productionReady:false,note:'Passing local configuration is NOT a live handshake with an existing platform.'};
mkdirSync(resolve('reports'),{recursive:true});writeFileSync(resolve('reports/integration-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({missing:report.missingIds,configured:status.filter(x=>x.configured).length,total:status.length,productionReady:false}));
if(process.argv.includes('--require-live')||report.missingIds.length||report.repeatedCredentialVars.length)process.exitCode=1;
