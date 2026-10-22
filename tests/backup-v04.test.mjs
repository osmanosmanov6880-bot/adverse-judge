import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {JudgeService} from '../server/service.mjs';
import {backupDatabase} from '../scripts/backup.mjs';
import {inspectBackup} from '../scripts/backup-inspect.mjs';
test('backup rehearsal checks checksum and replays event ledger on a clean copy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-v04-backup-'));
 try{
  const src=join(dir,'source.sqlite'),dst=join(dir,'backup.sqlite');
  let store=new Store(src);new JudgeService(store).create('owner',{claim:'A clear and useful advertisement'});
  const report=await backupDatabase(src,dst);
  assert.equal(report.verification.ok,true);
  const checked=inspectBackup(dst);assert.equal(checked.ok,true);assert.equal(checked.casesChecked,1);
  store.close();
  const meta=JSON.parse(readFileSync(dst+'.json'));meta.sha256='0'.repeat(64);writeFileSync(dst+'.json',JSON.stringify(meta));
  assert.throws(()=>inspectBackup(dst),/checksum mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
