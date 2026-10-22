/** Evidence-based production gate. Never claims readiness while blockers remain. */
import {createApp} from '../server/index.mjs';
const args=process.argv.slice(2);
if(args.some(x=>!['--attest','--strict'].includes(x))){console.error('Usage: node scripts/readiness-v030.mjs [--attest] [--strict]');process.exit(2);}
const app=createApp();
try{
 const report=app.readiness.report();
 const attestation=args.includes('--attest')?app.readiness.attest():null;
 console.log(JSON.stringify({report,attestation},null,2));
 if(args.includes('--strict')&&report.blockers.length)process.exitCode=1;
}finally{app.store.close();}
