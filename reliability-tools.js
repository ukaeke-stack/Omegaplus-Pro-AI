export function normalizeFixtureName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(fc|cf|afc|sc|club)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
export function reconcileFixtures(input) {
  const fixtures = Array.isArray(input) ? input : [];
  const seenIds = new Map(), seenPairs = new Map();
  const issues = [];
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i] || {};
    const id = String(f.eventId ?? f.id ?? "").trim();
    const home = normalizeFixtureName(f.home ?? f.homeTeam);
    const away = normalizeFixtureName(f.away ?? f.awayTeam);
    const date = String(f.date ?? f.kickoffDate ?? "").slice(0, 10);
    if (!home || !away) issues.push({type:"missing-team", index:i, message:"Fixture is missing a home or away team."});
    if (home && away && home === away) issues.push({type:"same-team", index:i, message:"Home and away teams normalize to the same name."});
    if (id) {
      if (seenIds.has(id)) issues.push({type:"duplicate-id", index:i, otherIndex:seenIds.get(id), eventId:id, message:"Duplicate fixture ID."});
      else seenIds.set(id, i);
    }
    if (home && away) {
      const pair = [home, away].sort().join("|") + "|" + date;
      if (seenPairs.has(pair)) issues.push({type:"possible-duplicate-fixture", index:i, otherIndex:seenPairs.get(pair), date:date || null, message:"Same team pairing and date appears more than once; verify before removing either fixture."});
      else seenPairs.set(pair, i);
    }
  }
  return {checked:fixtures.length, issueCount:issues.length, issues};
}
export function providerSummary(health = {}) {
  return Object.entries(health).map(([name, value]) => ({
    name,
    available: typeof value === "boolean" ? value : Boolean(value?.ok ?? value?.available),
    detail: typeof value === "string" ? value : (value?.detail || null)
  }));
}
