/** Wave 25 — operational status: reports evidence, not imaginary readiness. */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {integrationReadiness} from './platform-config.mjs';
import {inspectBackup} from '../scripts/backup-inspect.mjs';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ReadinessService {
 constructor({store,judge,identity,delivery,env=process.env,origin='http://localhost:3000',dbPath=null}){
  this.store=store;this.judge=judge;this.identity=identity;this.delivery=delivery;this.env=env;this.origin=origin;this.dbPath=dbPath;
 }
 report(){
  const checks=[],add=(name,passed,severity,detail)=>checks.push({name,passed,severity,detail});
  const integrity=this.store.one('PRAGMA quick_check');add('database_integrity',Object.values(integrity||{}).every(x=>x==='ok'),'blocker','SQLite quick_check; not an off-site backup');
  const fk=this.store.all('PRAGMA foreign_key_check');add('foreign_keys',fk.length===0,'blocker',fk.length+' FK violations');
  add('durable_server_database',false,'blocker','SQLite is local-pilot persistence. PostgreSQL/replication not deployed');
  add('public_tls',this.origin.startsWith('https://'),'blocker','Public traffic must use HTTPS and be verified at the reverse proxy');
  add('verified_identity_delivery',!!this.identity.mailer,'blocker','Email delivery provider configured: '+!!this.identity.mailer);
  add('verified_identity_required',this.identity.requireVerified,'blocker','Require confirmed email for collaboration');
  add('persistent_hmac_ledger',!!this.store.ledgerSecret,'blocker','A protected stable HMAC key is required');
  const partner=this.judge.platforms.map(p=>integrationReadiness(p,{env:this.env,secret:this.judge.secret}));
  add('partner_contracts_7_of_7',partner.length===7&&partner.every(x=>x.configured),'blocker','Configured contract adapters: '+partner.filter(x=>x.configured).length+'/'+partner.length+'; no live event is implied');
  const queues=this.store.one("SELECT COUNT(*) AS n FROM delivery_queue WHERE status IN ('queued','retry','sending')").n;
  add('outbox_empty',queues===0,'warning','Pending delivery items: '+queues);
  let backup=false;
  if(this.env.JUDGE_LAST_BACKUP_MANIFEST){try{const name=resolve(this.env.JUDGE_LAST_BACKUP_MANIFEST);if(!name.endsWith('.sqlite.json'))throw Error('Invalid backup manifest suffix');const m=JSON.parse(readFileSync(name,'utf8'));backup=m.format==='judge-backup-v1'&&Number.isFinite(Date.parse(m.createdAt))&&Date.now()-Date.parse(m.createdAt)<86400000&&inspectBackup(name.slice(0,-5)).ok;}catch{}}
  add('recent_backup',backup,'blocker','Last verified backup manifest from last 24h: '+backup);
  const total=this.store.one('SELECT COUNT(*) AS n FROM cases').n,ledgers=this.store.one('SELECT COUNT(DISTINCT case_id) AS n FROM event_attestations').n;
  add('ledger_coverage',total===ledgers,'blocker',ledgers+' of '+total+' cases have event attestations; full replay still required');
  add('external_load_and_security_review',false,'blocker','Independent security audit, anti-fraud and production load test missing');
  return {schema:'adverse-readiness-1',version:'0.30.0',generatedAt:new Date().toISOString(),productionReady:false,
   classification:'local-pilot-or-protected-staging',checks,blockers:checks.filter(x=>!x.passed&&x.severity==='blocker').map(x=>x.name),
   metrics:{cases:total,pendingDeliveries:queues,platformContractsReady:partner.filter(x=>x.configured).length},
   disclaimer:'A passing local diagnostic is not proof of deployed availability, privacy-law compliance, external partner delivery or marketing performance.'};
 }
 attest(){const report=this.report(),id=randomUUID(),digest=sha(report);
  this.store.run('INSERT INTO operator_checks(id,check_type,result,result_digest,created_at) VALUES(?,?,?,?,?)',id,'readiness',JSON.stringify(report),digest,report.generatedAt);
  return {id,sha256:digest,productionReady:false,blockers:report.blockers};
 }
 history(){return this.store.all('SELECT id,result_digest AS sha256,created_at AS createdAt FROM operator_checks ORDER BY created_at DESC LIMIT 20');}
}
