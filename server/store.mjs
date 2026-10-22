import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import { dirname } from 'node:path';

export function ledgerDigest(entry,previous,secret='') {
  const payload=JSON.stringify([entry.case_id,String(entry.id),entry.type,entry.data,entry.at,previous]);
  return secret?createHmac('sha256',secret).update(payload).digest('hex'):
    createHash('sha256').update(payload).digest('hex');
}
export class Store {
  constructor(file,{ledgerSecret=process.env.JUDGE_LEDGER_SECRET||''}={}) {
    if(ledgerSecret && ledgerSecret.length<32)throw new Error('JUDGE_LEDGER_SECRET must be at least 32 chars when provided');
    this.ledgerSecret=ledgerSecret;
    this.ledgerMode=ledgerSecret?'HMAC-SHA256':'SHA256 (unkeyed)';
    this.ledgerKeyId=ledgerSecret?createHash('sha256').update(ledgerSecret).digest('hex').slice(0,20):'UNKEYED';
    if (file!==':memory:') mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);
    if(file!==':memory:') chmodSync(file,0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS cases_owner ON cases(owner_id,updated_at);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,type TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_case ON events(case_id,id);
      CREATE TABLE IF NOT EXISTS commands(case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,command_id TEXT NOT NULL,PRIMARY KEY(case_id,command_id));
      CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,verdict_id TEXT NOT NULL,claim TEXT NOT NULL,audience TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at TEXT,revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,platform_id TEXT NOT NULL,mode TEXT NOT NULL,brief TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,redeemed_at TEXT);
      CREATE TABLE IF NOT EXISTS integration_receipts(platform_id TEXT NOT NULL,event_id TEXT NOT NULL,handoff_id TEXT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(platform_id,event_id));
    `);
    // Non-destructive migration: preserve existing SQLite cases and event ledger.
    const version=this.one('PRAGMA user_version').user_version;
    if(version>28)throw new Error('Database schema newer than JUDGE; refusing downgrade');
    this.tx(()=>{
      const columns=table=>new Set(this.all(`PRAGMA table_info(${table})`).map(x=>x.name));
      const h=columns('handoffs');
      if(!h.has('verdict_id'))this.db.exec('ALTER TABLE handoffs ADD COLUMN verdict_id TEXT');
      if(!h.has('revoked_at'))this.db.exec('ALTER TABLE handoffs ADD COLUMN revoked_at TEXT');
      if(!columns('integration_receipts').has('action'))this.db.exec('ALTER TABLE integration_receipts ADD COLUMN action TEXT');
      const sessionCols=columns('sessions');
      if(!sessionCols.has('device_label'))this.db.exec("ALTER TABLE sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT 'Браузер'");
      if(!sessionCols.has('last_seen_at'))this.db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0');
      if(!h.has('redeem_request_hash'))this.db.exec('ALTER TABLE handoffs ADD COLUMN redeem_request_hash TEXT');
      this.db.exec('CREATE TABLE IF NOT EXISTS auth_failures (key_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
      this.db.exec('CREATE INDEX IF NOT EXISTS handoffs_case ON handoffs(case_id,created_at)');
      // Comparison Room v0.5.0. All invitation secrets are hashed; links are single-use.
      this.db.exec(`CREATE TABLE IF NOT EXISTS comparisons (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        verdict_id TEXT NOT NULL, question TEXT NOT NULL,
        variant_a TEXT NOT NULL, variant_b TEXT NOT NULL,
        seed INTEGER NOT NULL CHECK(seed IN (0,1)),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','invalidated')),
        created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS comparisons_case ON comparisons(case_id,created_at);
      CREATE TABLE IF NOT EXISTS comparison_links (
        id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, display_order TEXT NOT NULL CHECK(display_order IN ('ab','ba')),
        created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS comparison_links_parent ON comparison_links(comparison_id);
      CREATE TABLE IF NOT EXISTS comparison_votes (
        id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
        link_id TEXT NOT NULL UNIQUE REFERENCES comparison_links(id) ON DELETE CASCADE,
        selection TEXT NOT NULL CHECK(selection IN ('a','b','neither')),
        note TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comparison_votes_parent ON comparison_votes(comparison_id);`);
      // Wave 1: all business data is private unless the case owner explicitly shares it.
      this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner','reviewer','viewer')),
        joined_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_invites (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('reviewer','viewer')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at TEXT, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS workspace_cases (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        shared_by TEXT NOT NULL, shared_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,case_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_reviews (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT, type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members(user_id);
      CREATE INDEX IF NOT EXISTS workspace_reviews_case ON workspace_reviews(workspace_id,case_id);`);
      // Wave 2: observational research decisions are stored separately from comparison votes.
      this.db.exec(`CREATE TABLE IF NOT EXISTS research_studies (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
        verdict_id TEXT NOT NULL, hypothesis TEXT NOT NULL,
        target_responses INTEGER NOT NULL CHECK(target_responses BETWEEN 5 AND 30),
        status TEXT NOT NULL CHECK(status IN ('active','concluded')),
        created_at TEXT NOT NULL, closed_at TEXT,
        decision TEXT CHECK(decision IN ('iterate','retain','inconclusive')),
        decision_note TEXT
      );
      CREATE INDEX IF NOT EXISTS research_case ON research_studies(case_id,created_at);`);
      // Wave 5: append-only digest chain per case; existing histories acquire a
      // migration baseline. Old events are NOT retrospectively trusted.
      this.db.exec(`CREATE TABLE IF NOT EXISTS ledger_meta (
        id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL,key_id TEXT NOT NULL,first_attested_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_attestations (
        event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL, previous_digest TEXT NOT NULL,digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS event_attestations_case ON event_attestations(case_id,event_id);`);
      const meta=this.one('SELECT * FROM ledger_meta WHERE id=1');
      if(meta&&(meta.mode!==this.ledgerMode||meta.key_id!==this.ledgerKeyId))
        throw new Error('Ledger key or algorithm mismatch. Restore the original JUDGE_LEDGER_SECRET; never silently rekey an existing database.');
      if(!meta)this.run('INSERT INTO ledger_meta VALUES(1,?,?,?)',this.ledgerMode,this.ledgerKeyId,new Date().toISOString());
      if(!meta) {
        const histories=this.all('SELECT id,case_id,type,data,at FROM events ORDER BY case_id,id');
        let previousCase=null,previous='GENESIS';
        for(const event of histories){
          if(event.case_id!==previousCase){previous='GENESIS';previousCase=event.case_id;}
          const digest=ledgerDigest(event,previous,this.ledgerSecret);
          this.run('INSERT INTO event_attestations(event_id,case_id,previous_digest,digest) VALUES(?,?,?,?)',event.id,event.case_id,previous,digest);
          previous=digest;
        }
      }
      // Waves 6-10: workspace-scoped production workflow. Each mutation is
      // version-checked and approvals never apply across revisions.
      this.db.exec(`CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        creator_id TEXT, name TEXT NOT NULL, objective TEXT NOT NULL, audience TEXT NOT NULL,
        channel TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','in_review','approved','archived')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS campaigns_workspace ON campaigns(workspace_id,updated_at);
      CREATE TABLE IF NOT EXISTS campaign_briefs (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        verdict_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        created_by TEXT, created_at TEXT NOT NULL, UNIQUE(campaign_id,case_id)
      );
      CREATE TABLE IF NOT EXISTS campaign_evidence (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        brief_id TEXT NOT NULL REFERENCES campaign_briefs(id) ON DELETE CASCADE,
        statement TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('document','dataset','url','testimonial')),
        locator TEXT NOT NULL, explanation TEXT NOT NULL, expires_at TEXT,
        review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','reviewed')),
        created_by TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS campaign_evidence_brief ON campaign_evidence(brief_id);
      CREATE TABLE IF NOT EXISTS campaign_creatives (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        brief_id TEXT NOT NULL REFERENCES campaign_briefs(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK(channel IN ('search','social','email')),
        language TEXT NOT NULL CHECK(language IN ('ru','en','zh')),
        headline TEXT NOT NULL, body TEXT NOT NULL, cta TEXT NOT NULL,
        created_by TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign_reviews (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, requested_by TEXT NOT NULL, request_note TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','changes_requested','superseded')),
        reviewer_id TEXT, review_note TEXT, created_at TEXT NOT NULL, decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS campaign_reviews_parent ON campaign_reviews(campaign_id,revision);
      CREATE TABLE IF NOT EXISTS campaign_releases (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
        created_by TEXT, created_at TEXT NOT NULL, UNIQUE(campaign_id,revision)
      );
      CREATE TABLE IF NOT EXISTS campaign_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        actor_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS campaign_events_parent ON campaign_events(campaign_id,id);
      CREATE TRIGGER IF NOT EXISTS campaign_release_no_update
      BEFORE UPDATE ON campaign_releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
      `);
      // Waves 11-15: optional brand rules, locale coverage, reproducible QA,
      // signed partner release exchange and source-labelled performance observations.
      this.db.exec(`CREATE TABLE IF NOT EXISTS brand_kits (
        id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,voice TEXT NOT NULL,forbidden_terms TEXT NOT NULL,
        required_terms TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS brand_workspace ON brand_kits(workspace_id);
      CREATE TABLE IF NOT EXISTS campaign_brand (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS campaign_targets (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK(channel IN ('search','social','email')),
        language TEXT NOT NULL CHECK(language IN ('ru','en','zh')),
        PRIMARY KEY(campaign_id,channel,language)
      );
      CREATE TABLE IF NOT EXISTS campaign_quality_runs (
        id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, digest TEXT NOT NULL,findings TEXT NOT NULL,
        passed INTEGER NOT NULL CHECK(passed IN (0,1)),actor_id TEXT,created_at TEXT NOT NULL,
        UNIQUE(campaign_id,revision)
      );
      CREATE TABLE IF NOT EXISTS release_dispatches (
        id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES campaign_releases(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        platform_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('issued','redeemed','confirmed','revoked')),
        created_by TEXT,created_at TEXT NOT NULL,redeemed_at TEXT,confirmed_at TEXT,
        redeem_request_hash TEXT,confirmed_action TEXT,confirmed_event_id TEXT,
        UNIQUE(release_id,platform_id)
      );
      CREATE INDEX IF NOT EXISTS dispatch_campaign ON release_dispatches(campaign_id,created_at);
      CREATE TABLE IF NOT EXISTS dispatch_receipts (
        platform_id TEXT NOT NULL,event_id TEXT NOT NULL,dispatch_id TEXT NOT NULL REFERENCES release_dispatches(id) ON DELETE CASCADE,
        action TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(platform_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS campaign_observations (
        id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES campaign_releases(id) ON DELETE CASCADE,
        date TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('manual','partner_report')),
        spend_minor INTEGER NOT NULL CHECK(spend_minor>=0),impressions INTEGER NOT NULL CHECK(impressions>=0),
        clicks INTEGER NOT NULL CHECK(clicks>=0),leads INTEGER NOT NULL CHECK(leads>=0),
        currency TEXT NOT NULL,note TEXT NOT NULL,actor_id TEXT,created_at TEXT NOT NULL,
        retracted_at TEXT,retracted_by TEXT,retraction_note TEXT
      );
      CREATE INDEX IF NOT EXISTS observations_campaign ON campaign_observations(campaign_id,date);
      CREATE TABLE IF NOT EXISTS advanced_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        actor_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL
      );
      `);
      // Waves 16-20. All tables remain server-authoritative; existing rows are preserved.
      this.db.exec(`CREATE TABLE IF NOT EXISTS campaign_evidence_policy (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        require_mapping INTEGER NOT NULL CHECK(require_mapping IN (0,1)) DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS campaign_claim_links (
        creative_id TEXT NOT NULL REFERENCES campaign_creatives(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES campaign_evidence(id) ON DELETE CASCADE,
        created_by TEXT,created_at TEXT NOT NULL,PRIMARY KEY(creative_id,evidence_id)
      );
      CREATE TABLE IF NOT EXISTS campaign_issues (
        id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        creative_id TEXT REFERENCES campaign_creatives(id) ON DELETE SET NULL,
        severity TEXT NOT NULL CHECK(severity IN ('critical','major','minor')),
        title TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','resolved')),
        reported_by TEXT,resolved_by TEXT,resolution_note TEXT,created_at TEXT NOT NULL,resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS campaign_issues_parent ON campaign_issues(campaign_id,status,severity);
      CREATE TABLE IF NOT EXISTS campaign_budgets (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        currency TEXT NOT NULL,cap_minor INTEGER NOT NULL CHECK(cap_minor>=100),
        mode TEXT NOT NULL CHECK(mode IN ('warn','hold')),
        updated_by TEXT,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_controls (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        dispatch_paused INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_paused IN (0,1)),
        reason TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_operational_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL
      );`);
      // Waves 21-25: verified identity, revision snapshots, measurement batches,
      // bounded delivery queue and operator audit. Non-destructive migrations.
      this.db.exec(`CREATE TABLE IF NOT EXISTS account_verifications (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        verified_at TEXT,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS email_challenges (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
        token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,
        issued_at TEXT NOT NULL,consumed_at TEXT,revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS email_challenge_lookup ON email_challenges(user_id,purpose,expires_at);
      CREATE TABLE IF NOT EXISTS creative_revision_snapshots (
        id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES campaign_releases(id) ON DELETE CASCADE,
        previous_revision INTEGER NOT NULL,new_revision INTEGER NOT NULL,
        prior_creatives TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS measurement_batches (
        id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES campaign_releases(id) ON DELETE CASCADE,
        digest TEXT NOT NULL,source_name TEXT NOT NULL,row_count INTEGER NOT NULL,
        created_by TEXT,created_at TEXT NOT NULL,UNIQUE(campaign_id,digest)
      );
      CREATE TABLE IF NOT EXISTS measurement_batch_rows (
        batch_id TEXT NOT NULL REFERENCES measurement_batches(id) ON DELETE CASCADE,
        observation_id TEXT NOT NULL REFERENCES campaign_observations(id) ON DELETE CASCADE,
        source_row INTEGER NOT NULL,PRIMARY KEY(batch_id,source_row),UNIQUE(observation_id)
      );
      CREATE TABLE IF NOT EXISTS delivery_queue (
        id TEXT PRIMARY KEY,dispatch_id TEXT NOT NULL UNIQUE REFERENCES release_dispatches(id) ON DELETE CASCADE,
        platform_id TEXT NOT NULL,endpoint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','sending','retry','accepted','failed','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_http_status INTEGER,last_error TEXT,
        idempotency_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS delivery_due ON delivery_queue(status,next_attempt_at);
      CREATE TABLE IF NOT EXISTS operator_checks (
        id TEXT PRIMARY KEY,check_type TEXT NOT NULL,result TEXT NOT NULL,
        result_digest TEXT NOT NULL,created_at TEXT NOT NULL
      );`);
      // CINEMA 1.1: review-proposal provenance; guest ownership follows the case.
      // Case deletion cascades, and the owner's export includes this record.
      this.db.exec(`CREATE TABLE IF NOT EXISTS cinema_imports (
        case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        proposed_claim TEXT NOT NULL,strategy TEXT,
        evidence_status TEXT NOT NULL,evidence_text TEXT NOT NULL,
        witness TEXT,imported_at TEXT NOT NULL,
        UNIQUE(owner_id,fingerprint)
      );`);
      this.db.exec('PRAGMA user_version=28');
    });
  }
  one(sql,...args) {return this.db.prepare(sql).get(...args);}
  all(sql,...args) {return this.db.prepare(sql).all(...args);}
  run(sql,...args) {return this.db.prepare(sql).run(...args);}
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=fn(); if (result?.then) throw new Error('Transactions must not cross async boundaries'); this.db.exec('COMMIT'); return result;}
    catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  recordEvent(caseId,type,data,at){
    const raw=typeof data==='string'?data:JSON.stringify(data);
    const result=this.run('INSERT INTO events(case_id,type,data,at) VALUES(?,?,?,?)',caseId,type,raw,at);
    const id=Number(result.lastInsertRowid);
    const prev=this.one('SELECT digest FROM event_attestations WHERE case_id=? ORDER BY event_id DESC LIMIT 1',caseId)?.digest||'GENESIS';
    const digest=ledgerDigest({id,case_id:caseId,type,data:raw,at},prev,this.ledgerSecret);
    this.run('INSERT INTO event_attestations(event_id,case_id,previous_digest,digest) VALUES(?,?,?,?)',id,caseId,prev,digest);
    return id;
  }
  auditLedger(caseId){
    const rows=this.all(`SELECT e.id,e.case_id,e.type,e.data,e.at,a.previous_digest,a.digest
      FROM events e LEFT JOIN event_attestations a ON a.event_id=e.id WHERE e.case_id=? ORDER BY e.id`,caseId);
    let previous='GENESIS';
    for(const row of rows){
      if(!row.digest||row.previous_digest!==previous||row.digest!==ledgerDigest(row,previous,this.ledgerSecret))
        return {consistent:false,eventsChecked:rows.length,mode:this.ledgerMode};
      previous=row.digest;
    }
    return {consistent:rows.length>0,eventsChecked:rows.length,mode:this.ledgerMode};
  }
  close() {this.db.close();}
}