import test from "node:test";
import assert from "node:assert/strict";
import { deriveModel } from "../model-ensemble.js";
import { enrichPredictions } from "../independent-stats.js";
import { assessPredictionReliability, rankByReliability } from "../analyzer-reliability.js";

test("model withholds probabilities when there is no valid independent evidence", () => {
  const result = deriveModel({ marketConfidence: 84, pick: "Over 1.5", marketType: "ou" });
  assert.equal(result.modelInputsAvailable, false);
  assert.equal(result.modelProbability, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedGoals, null);
});

test("GOAL API recent form can supply a model when both teams have enough results", () => {
  const result = deriveModel({
    marketConfidence: 80, independentConfidence: 25, pick: "Over 1.5", marketType: "ou",
    independentStats: { goalApi: { form: {
      homeMatches: 8, awayMatches: 9, homeGoalsFor: 1.8, awayGoalsFor: 1.3,
      homeGoalsAgainst: 1.0, awayGoalsAgainst: 1.4,
      homeWinRate: 0.5, awayWinRate: 0.4
    } } }
  });
  assert.equal(result.modelInputsAvailable, true);
  assert.ok(Number.isFinite(result.modelProbability));
  assert.equal(result.ensembleConfidence, Math.round(80 * 0.65 + result.modelProbability * 0.35));
});

test("non-football analysis never applies football form or xG models", async () => {
  const [prediction] = await enrichPredictions([{
    id: "basketball-1", home: "Team A", away: "Team B",
    startTimeMs: Date.parse("2026-10-12T12:00:00Z"),
    marketType: "basketball_total", pick: "Over 145.5", confidence: 76, odds: 1.7
  }], { sport: "basketball", concurrency: 1, confidenceFloor: 0 });
  assert.deepEqual(prediction.independentSources, []);
  assert.equal(prediction.modelProbability, null);
  assert.equal(prediction.independentConfidence, null);
  assert.equal(prediction.independentStats.models.probabilities, null);
  assert.equal(prediction.confidence, 76);
});

test("form sample selection favors the source with a complete recent sample", () => {
  const result = deriveModel({
    marketConfidence: 72, pick: "Over 2.5", marketType: "ou",
    independentStats: {
      sofascore: { form: { homeMatches: 2, awayMatches: 2, homeGoalsFor: 0.5, awayGoalsFor: 0.5 } },
      goalApi: { form: { homeMatches: 8, awayMatches: 8, homeGoalsFor: 1.7, awayGoalsFor: 1.2, homeGoalsAgainst: 1.1, awayGoalsAgainst: 1.4 } }
    }
  });
  assert.equal(result.modelInputsAvailable, true);
  assert.ok(result.expectedGoals.total > 2);
});

test("GOAL API form samples contribute to reliability and quality grade", () => {
  const prediction = {
    confidence: 78, marketConfidence: 78, independentConfidence: 74, modelProbability: 73,
    marketType: "ou", pick: "Over 1.5", independentSources: ["goalapi"],
    independentStats: { goalApi: { form: { homeMatches: 9, awayMatches: 8 } } }
  };
  const result = assessPredictionReliability(prediction);
  assert.equal(result.recentSampleSize, 8);
  assert.equal(result.independentSourceCount, 1);
  assert.equal(result.evidenceLevel, "Moderate");
  assert.ok(result.reliabilityScore > 0);
});

test("conflicting independent and market signals reduce reliability", () => {
  const result = assessPredictionReliability({
    confidence: 90, marketConfidence: 90, independentConfidence: 52, modelProbability: 50,
    modelAgreement: 48, marketType: "btts", pick: "Yes", independentSources: ["sofascore"],
    independentStats: { sofascore: { form: { homeMatches: 8, awayMatches: 8 } } }
  });
  assert.equal(result.evidenceLevel, "Conflicting");
  assert.ok(result.disagreementPenalty >= 15);
});

test("reliability ranking prefers supported evidence over confidence alone", () => {
  const ranked = rankByReliability([
    { id: "unsupported", confidence: 88, marketConfidence: 88, marketType: "ou", pick: "Over 1.5" },
    { id: "supported", confidence: 76, marketConfidence: 76, independentConfidence: 74, modelProbability: 73,
      marketType: "ou", pick: "Over 1.5", modelAgreement: 90, independentSources: ["goalapi", "understat"],
      independentStats: { goalApi: { form: { homeMatches: 9, awayMatches: 8 } } } }
  ]);
  assert.equal(ranked[0].id, "supported");
});
