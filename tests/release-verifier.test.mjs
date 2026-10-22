import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyReleaseObject} from '../scripts/verify-release.mjs';
const payload={schema:'adverse-editorial-release-1',campaign:{id:'example',revision:5},briefs:[{caseId:'caseA'}],evidence:[{locator:'Doc 5'}],creatives:[{headline:'Build a clearer ad'}],createdAt:'2026-10-22T00:00:00Z'};
const exported={id:'mock',sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),...payload,deliveryConfirmed:false};
test('offline verification accepts unchanged server-formatted JSON export',()=>{
 const result=verifyReleaseObject(exported);assert.equal(result.ok,true);assert.equal(result.creatives,1);assert.equal(result.declaresExternalDelivery,false);
});
test('offline verification rejects modified payload without a new digest',()=>{
 const result=verifyReleaseObject({...exported,creatives:[{headline:'Guaranteed sales immediately'}]});assert.equal(result.ok,false);assert.equal(result.digestMatches,false);
});
test('offline verification cannot be used to claim real external delivery',()=>{
 assert.equal(verifyReleaseObject({...exported,deliveryConfirmed:true}).ok,false);
 assert.equal(verifyReleaseObject({...exported,sha256:'broken'}).ok,false);
});
