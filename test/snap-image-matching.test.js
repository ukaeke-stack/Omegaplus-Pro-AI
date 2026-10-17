import test from "node:test";
import assert from "node:assert/strict";
import { matchSnapImageFixtures } from "../snap-image-matching.js";

const fixtures = [
  { eventId: "a", home: "Manchester United", away: "Chelsea", startTimeMs: Date.UTC(2026, 9, 16, 18, 30) },
  { eventId: "b", home: "Arsenal", away: "Liverpool", startTimeMs: Date.UTC(2026, 9, 16, 20, 0) }
];

test("matches exact team names from an ordinary fixture list, not just booking slips", () => {
  const found = matchSnapImageFixtures("Premier League\nManchester United vs Chelsea\n16/10/2026 19:30\n1.95 3.20 4.10", fixtures);
  assert.equal(found.length > 0, true);
  assert.equal(found[0].fixture.eventId, "a");
  assert.match(found[0].matchMethod, /team-name/);
});

test("tolerates common OCR spelling mistakes in team names", () => {
  const found = matchSnapImageFixtures("Manchest er Unlted v CheIsea\n16 Oct 2026 18:30", fixtures);
  assert.equal(found.some(item => item.fixture.eventId === "a"), true);
});

test("does not fabricate a match when both team names are not recognizable", () => {
  const found = matchSnapImageFixtures("Premier League\n1.95 3.20 4.10\n16/10/2026 18:30", fixtures);
  assert.deepEqual(found, []);
});

test("uses nearby date and kickoff time as supporting match evidence", () => {
  const found = matchSnapImageFixtures("Manchester United vs Chelsea\n16/10/2026 18:30", fixtures);
  assert.equal(found[0].fixture.eventId, "a");
  assert.ok(found[0].matchConfidence >= 90);
});

test("keeps nearby original market and selection text with the matched fixture", () => {
  const found = matchSnapImageFixtures("Premier League\nManchester United vs Chelsea\nOver 2.5 Goals\n16/10/2026 19:30\n1.95 3.20 4.10", fixtures);
  assert.equal(found[0].fixture.eventId, "a");
  assert.match(found[0].context, /Over 2\.5 Goals/);
});
