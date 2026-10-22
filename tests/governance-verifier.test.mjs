import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {verifyGovernance} from '../scripts/verify-governance.mjs';
test('wave20: exported payload integrity can be checked offline without privileged keys',()=>{
 const payload={schema:'adverse-governance-audit-1',campaign:{id:'demo'},disclosures:['Internal only'],releaseDigests:[]};
 const obj={payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
 assert.equal(verifyGovernance(obj).ok,true);
 assert.equal(verifyGovernance({...obj,sha256:'f'.repeat(64)}).reason,'SHA256_MISMATCH');
 assert.equal(verifyGovernance({...obj,payload:{...payload,campaign:{id:'changed'}}}).ok,false);
 assert.equal(verifyGovernance({}).reason,'SCHEMA_MISMATCH');
});
