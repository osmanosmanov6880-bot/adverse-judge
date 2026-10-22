/** Read-only consistency verifier: SQLite integrity + exact reconstruction from domain events.
 * Does not log claims, user addresses or event payloads. */
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {replay} from '../shared/domain.mjs';
import {ledgerDigest} from '../server/store.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function verifyDatabase(file){
  if(!existsSync(file))throw Error('Database does not exist: '+file);
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const integrity=db.prepare('PRAGMA integrity_check').all().every(row=>Object.values(row).every(x=>x==='ok'));
    const foreignKeys=db.prepare('PRAGMA foreign_key_check').all().length;
    const cases=db.prepare('SELECT id,state FROM cases').all();
    const eventStatement=db.prepare('SELECT type,data,at FROM events WHERE case_id=? ORDER BY id');
    let replayFailures=0,eventsChecked=0,ledgerFailures=0;
    const hasLedger=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_attestations'").get());
    const attested=hasLedger?db.prepare(`SELECT e.id,e.case_id,e.type,e.data,e.at,a.previous_digest,a.digest
      FROM events e LEFT JOIN event_attestations a ON a.event_id=e.id WHERE e.case_id=? ORDER BY e.id`):null;
    const meta=hasLedger?db.prepare('SELECT * FROM ledger_meta WHERE id=1').get():null;
    const secret=process.env.JUDGE_LEDGER_SECRET||'';
    const mode=secret?'HMAC-SHA256':'SHA256 (unkeyed)';
    if(hasLedger&&(meta?.mode!==mode||meta?.key_id!==(secret?createHash('sha256').update(secret).digest('hex').slice(0,20):'UNKEYED')))
      throw new Error('Incorrect JUDGE_LEDGER_SECRET or ledger algorithm');
    for(const row of cases){
      try{
        if(attested){
          let prev='GENESIS',valid=true;
          for(const event of attested.all(row.id)){
            if(!event.digest||event.previous_digest!==prev||event.digest!==ledgerDigest(event,prev,secret)){valid=false;break;}
            prev=event.digest;
          }
          if(!valid)ledgerFailures++;
        }
        const events=eventStatement.all(row.id).map(e=>({type:e.type,data:JSON.parse(e.data),at:e.at}));
        eventsChecked+=events.length;
        if(!isDeepStrictEqual(JSON.parse(row.state),replay(events)))replayFailures++;
      }catch{replayFailures++;}
    }
    return {ok:integrity&&foreignKeys===0&&replayFailures===0&&ledgerFailures===0,integrity,foreignKeyViolations:foreignKeys,replayFailures,ledgerFailures,ledgerMode:meta?.mode||'legacy unattested',casesChecked:cases.length,eventsChecked};
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const path=resolve(process.argv[2]??process.env.JUDGE_DB??resolve(ROOT,'data/judge.sqlite'));
  try{const result=verifyDatabase(path);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
  catch(e){console.error('Database verification failed:',e.message);process.exitCode=1;}
}
