/** Backup rehearsal: verifies SHA-256 and domain replay on a copy, never overwrites live DB. */
import {readFileSync,existsSync,statSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyDatabase} from './verify-db.mjs';
export function inspectBackup(backupPath){
 const path=resolve(backupPath),manifestPath=path+'.json';
 if(!existsSync(path)||!existsSync(manifestPath))throw Error('Backup and adjacent manifest must both exist');
 const meta=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(meta.format!=='judge-backup-v1'||!Number.isSafeInteger(meta.sizeBytes)||!(/^[a-f0-9]{64}$/.test(meta.sha256)))throw Error('Unrecognized backup manifest');
 if(statSync(path).size!==meta.sizeBytes)throw Error('Backup size differs from manifest');
 const found=createHash('sha256').update(readFileSync(path)).digest('hex');
 if(found!==meta.sha256)throw Error('Backup checksum mismatch');
 const tmp=mkdtempSync(join(tmpdir(),'judge-restore-rehearsal-'));
 try{
   const restored=join(tmp,'restored.sqlite');copyFileSync(path,restored);
   const integrity=verifyDatabase(restored);
   if(!integrity.ok)throw Error('Restored copy failed integrity/event replay check');
   return {ok:true,restoredCopyVerified:true,checksumMatches:true,casesChecked:integrity.casesChecked,eventsChecked:integrity.eventsChecked,
     warning:'A local restore rehearsal does not prove off-site recovery or deletion from existing backups.'};
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
   if(!process.argv[2])throw Error('Usage: npm run backup:inspect -- /path/to/backup.sqlite');
   console.log(JSON.stringify(inspectBackup(process.argv[2]),null,2));
 }catch(e){console.error('Backup inspection failed:',e.message);process.exitCode=1;}
}
