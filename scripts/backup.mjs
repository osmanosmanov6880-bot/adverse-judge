/** Consistent online backup using Node sqlite.backup: never copy WAL files by hand. */
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync,writeFileSync,statSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyDatabase} from './verify-db.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function backupDatabase(source,destination){
  const from=resolve(source),to=resolve(destination);
  if(from===to)throw Error('Source and destination must differ');
  if(!existsSync(from))throw Error('Database does not exist');
  if(existsSync(to)||existsSync(to+'.json'))throw Error('Backup destination already exists (never overwrite existing backups)');
  mkdirSync(dirname(to),{recursive:true,mode:0o700});
  const db=new DatabaseSync(from,{readOnly:true});
  try{await backup(db,to);}finally{db.close();}
  chmodSync(to,0o600);
  const verification=verifyDatabase(to);
  if(!verification.ok)throw Error('Backup verification failed: '+JSON.stringify(verification));
  const manifest={format:'judge-backup-v1',createdAt:new Date().toISOString(),file:basename(to),sizeBytes:statSync(to).size,sha256:createHash('sha256').update(readFileSync(to)).digest('hex'),verification,warning:'Contains personal data in plaintext. Store encrypted, restrict access and enforce retention.'};
  writeFileSync(to+'.json',JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const source=resolve(process.env.JUDGE_DB??resolve(ROOT,'data/judge.sqlite'));
  const name='JUDGE-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'.sqlite';
  const dest=resolve(process.argv[2]??resolve(ROOT,'backups',name));
  try{const result=await backupDatabase(source,dest);console.log(JSON.stringify({path:dest,...result},null,2));}
  catch(e){console.error('Backup failed:',e.message);process.exitCode=1;}
}
