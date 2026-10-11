const SUPPORTED_MODEL_TYPES = new Set(["ou", "btts", "1x2", "double_chance", "team_goals", "first_half_ou", "btts_goals"]);

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function sourceList(prediction) {
  return Array.isArray(prediction?.independentSources)
    ? [...new Set(prediction.independentSources.map(x => String(x).trim().toLowerCase()).filter(Boolean))]
    : [];
}

function sampleCount(prediction) {
  const form = prediction?.independentStats?.sofascore?.form;
  const home = finite(form?.homeMatches);
  const away = finite(form?.awayMatches);
  return Math.max(home || 0, away || 0);
}

function marketModelApplies(prediction) {
  const type = String(prediction?.marketType || "").toLowerCase();
  if (!SUPPORTED_MODEL_TYPES.has(type)) return false;
  const pick = String(prediction?.pick || "");
  return type !== "ou" || /over\s*1\.5|over\s*2\.5/i.test(pick);
}

/**
 * Reliability is an evidence-quality ranking aid, not a win probability.
 * It deliberately keeps the raw model confidence separate from evidence quality.
 */
export function assessPredictionReliability(prediction = {}) {
  const sources = sourceList(prediction);
  const independent = finite(prediction.independentConfidence);
  const market = finite(prediction.marketConfidence ?? prediction.confidence);
  const model = prediction.derivedModel ? finite(prediction.derivedModel.modelProbability) : finite(prediction.modelProbability);
  const agreement = finite(prediction.modelAgreement);
  const applicable = marketModelApplies(prediction);
  const hasStats = sources.length > 0 && independent !== null;
  const evidenceScore = sources.length >= 2 ? 100 : sources.length === 1 ? 72 : 35;
  const sample = sampleCount(prediction);
  const sampleScore = sample >= 8 ? 100 : sample >= 5 ? 80 : sample > 0 ? 55 : 35;

  let disagreementPenalty = 0;
  const signals = [market, independent, model].filter(v => v !== null);
  if (signals.length >= 2) {
    const spread = Math.max(...signals) - Math.min(...signals);
    disagreementPenalty = clamp((spread - 10) * 0.55, 0, 22);
  }
  if (agreement !== null && agreement < 65) {
    disagreementPenalty = Math.max(disagreementPenalty, (65 - agreement) * 0.45);
  }

  // For markets the current independent model does not cover, report evidence
  // coverage without pretending the model independently validated that market.
  const modelCoverage = applicable && model !== null && hasStats;
  let reliabilityScore = 0.55 * clamp(market ?? 0) + 0.25 * evidenceScore + 0.20 * sampleScore;
  if (applicable && modelCoverage) reliabilityScore += 0.05 * clamp(agreement ?? 70) - 3;
  reliabilityScore -= disagreementPenalty;
  if (!hasStats) reliabilityScore -= 8;
  reliabilityScore = Math.round(clamp(reliabilityScore));

  let evidenceLevel = "Limited";
  if (hasStats && sources.length >= 2 && sample >= 5 && disagreementPenalty < 10) evidenceLevel = "Strong";
  else if (hasStats && (sources.length >= 1 || sample > 0)) evidenceLevel = "Moderate";
  if (disagreementPenalty >= 15) evidenceLevel = "Conflicting";

  return {
    reliabilityScore,
    evidenceLevel,
    independentSourceCount: sources.length,
    independentSources: sources,
    recentSampleSize: sample || null,
    modelApplicable: applicable,
    modelCoverage,
    disagreementPenalty: Math.round(disagreementPenalty),
    notes: [
      !hasStats ? "Independent evidence unavailable; ranking relies mainly on market prices." : null,
      applicable && !modelCoverage ? "Market-specific model evidence is incomplete." : null,
      disagreementPenalty >= 10 ? "Prediction signals disagree; treat this selection cautiously." : null,
      evidenceLevel === "Strong" ? "Multiple evidence signals and recent sample are available." : null
    ].filter(Boolean)
  };
}

export function rankByReliability(predictions = []) {
  return [...predictions].map(prediction => {
    const reliability = assessPredictionReliability(prediction);
    const grade = reliability.evidenceLevel === "Conflicting" ? "D" :
        reliability.evidenceLevel === "Strong" && reliability.reliabilityScore >= 80 ? "A" :
        reliability.evidenceLevel === "Moderate" && reliability.reliabilityScore >= 70 ? "B" :
        reliability.reliabilityScore >= 60 ? "C" : "D";
      return {
        ...prediction,
        reliability,
        reliabilityScore: reliability.reliabilityScore,
        qualityGrade: grade,
        reasons: [...(Array.isArray(prediction.reasons) ? prediction.reasons : []), ...reliability.notes]
      };
  }).sort((a, b) =>
    b.reliabilityScore - a.reliabilityScore ||
    (Number(b.confidence) || 0) - (Number(a.confidence) || 0) ||
    (Number(b.odds) || 0) - (Number(a.odds) || 0) ||
    (Number(a.startTimeMs) || 0) - (Number(b.startTimeMs) || 0)
  );
}
