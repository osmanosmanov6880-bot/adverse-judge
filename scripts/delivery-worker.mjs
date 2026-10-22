/** Manual one-shot local outbox worker. No background scheduler is started. */
import {createApp} from '../server/index.mjs';
const args=process.argv.slice(2);
if(args.some(x=>!['--once','--dry-run'].includes(x))){console.error('Use: node scripts/delivery-worker.mjs [--once | --dry-run]');process.exit(2);}
const app=createApp();
try{
 if(args.includes('--dry-run')){
  const due=app.store.one("SELECT COUNT(*) AS n FROM delivery_queue WHERE status IN ('queued','retry','sending') AND next_attempt_at<=?",Date.now()).n;
  console.log(JSON.stringify({mode:'dry-run',due,networkCalled:false,warning:'No external delivery in dry-run'}));
 }else{
  const results=await app.delivery.runDue({limit:10});console.log(JSON.stringify({mode:'one-shot',processed:results.length,results}));
  if(results.some(x=>x.error))process.exitCode=1;
 }
}finally{app.store.close();}
