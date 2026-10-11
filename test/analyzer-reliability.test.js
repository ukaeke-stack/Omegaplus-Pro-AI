import test from "node:test";
import assert from "node:assert/strict";
import { assessPredictionReliability, rankByReliability } from "../analyzer-reliability.js";
import { enrichPredictions } from "../independent-stats.js";
import { deriveModel } from "../model-ensemble.js";

test("missing independent evidence is explicitly limited", () => {
  const result = assessPredictionReliability({ confidence: 82, marketConfidence: 82, marketType: "ou", pick: "Over 1.5" });
  assert.equal(result.evidenceLevel, "Limited");
  assert.equal(result.independentSourceCount, 0);
  assert.ok(result.notes.some(note => note.includes("unavailable")));
});

test("multiple sources and recent samples improve evidence classification", () => {
  const result = assessPredictionReliability({
    confidence: 80, marketConfidence: 80, independentConfidence: 78, modelProbability: 79,
    modelAgreement: 90, marketType: "ou", pick: "Over 1.5",
    independentSources: ["sofascore", "understat"],
    independentStats: { sofascore: { form: { homeMatches: 10, awayMatches: 9 } } }
  });
  assert.equal(result.evidenceLevel, "Strong");
  assert.equal(result.independentSourceCount, 2);
  assert.ok(result.reliabilityScore > 70);
});

test("conflicting signals are surfaced and penalized", () => {
  const result = assessPredictionReliability({
    confidence: 90, marketConfidence: 90, independentConfidence: 55, modelProbability: 52,
    modelAgreement: 50, marketType: "btts", pick: "Yes",
    independentSources: ["sofascore"],
    independentStats: { sofascore: { form: { homeMatches: 8, awayMatches: 8 } } }
  });
  assert.equal(result.evidenceLevel, "Conflicting");
  assert.ok(result.disagreementPenalty >= 15);
});

test("ranking is stable for equal scores and does not mutate input", () => {
  const input = [
    { id: "limited", confidence: 88, marketConfidence: 88, marketType: "ou", pick: "Over 1.5" },
    { id: "strong", confidence: 75, marketConfidence: 75, independentConfidence: 75, modelProbability: 74, modelAgreement: 90, marketType: "ou", pick: "Over 1.5", independentSources: ["sofascore", "understat"], independentStats: { sofascore: { form: { homeMatches: 10, awayMatches: 10 } } } }
  ];
  const ranked = rankByReliability(input);
  assert.equal(input[0].reliability, undefined);
  assert.equal(ranked[0].id, "strong");
});

test("non-football predictions do not receive football xG/form model outputs", async () => {
  const [prediction] = await enrichPredictions([{
    id: "basketball-1", home: "Team A", away: "Team B",
    startTimeMs: Date.parse("2026-10-12T12:00:00Z"),
    marketType: "basketball_total", pick: "Over 145.5",
    confidence: 76, odds: 1.7
  }], { sport: "basketball", concurrency: 1 });
  assert.deepEqual(prediction.independentSources, []);
  assert.equal(prediction.modelProbability, null);
  assert.equal(prediction.independentConfidence, null);
});

test("goal model withholds probabilities when independent inputs are missing", () => {
  const result = deriveModel({ marketConfidence: 84, pick: "Over 1.5", marketType: "ou" });
  assert.equal(result.modelProbability, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.modelInputsAvailable, false);
});
