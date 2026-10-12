import test from "node:test";
import assert from "node:assert/strict";
import {reconcileFixtures, normalizeFixtureName, providerSummary} from "../reliability-tools.js";
test("normalizes common club-name differences",()=>assert.equal(normalizeFixtureName("North FC"),normalizeFixtureName("North")));
test("flags duplicate ids and possible same-date fixture duplicates without deleting data",()=>{
 const result=reconcileFixtures([
  {eventId:"a",home:"North FC",away:"South",date:"2026-10-12"},
  {eventId:"a",home:"South",away:"North",date:"2026-10-12"}
 ]);
 assert.ok(result.issues.some(x=>x.type==="duplicate-id"));
 assert.ok(result.issues.some(x=>x.type==="possible-duplicate-fixture"));
 assert.equal(result.checked,2);
});
test("reports missing team names",()=>assert.ok(reconcileFixtures([{eventId:"x",home:"",away:"South"}]).issues.some(x=>x.type==="missing-team")));
test("summarizes provider flags without leaking details",()=>assert.deepEqual(providerSummary({sofascore:true,understat:false}).map(x=>[x.name,x.available]),[["sofascore",true],["understat",false]]));
