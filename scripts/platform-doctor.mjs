/** Safe offline configuration diagnostics. Prints reasons, never values of credentials. */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validatePlatformManifest,integrationReadiness} from '../server/platform-config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function diagnosePlatformFile(file,{env=process.env,secret=env.HANDOFF_SECRET??''}={}){
  const manifest=validatePlatformManifest(JSON.parse(readFileSync(resolve(file),'utf8')));
  const items=manifest.map(p=>integrationReadiness(p,{env,secret}));
  return {schema:'judge-integration-readiness-v1',total:items.length,configured:items.filter(x=>x.configured).length,items,warning:'Контракт готов не означает подключения или подтверждённого рекламного действия. Внешние запросы не выполняются.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const file=process.env.JUDGE_PLATFORMS_FILE??resolve(root,'config/platforms.json');
  try{
    const report=diagnosePlatformFile(file);
    console.log(JSON.stringify(report,null,2));
    if(process.argv.includes('--require-ready')&&report.configured!==7)process.exitCode=1;
  }catch(e){console.error('JUDGE integration doctor:',e.message);process.exitCode=1;}
}
