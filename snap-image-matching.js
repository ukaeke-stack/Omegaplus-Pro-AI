const normalize = value => String(value ?? "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const ocrNormalize = value => normalize(value)
  .replace(/\b0(?=[a-z])/g, "o")
  .replace(/\b1(?=[a-z])/g, "l");

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 3 && (a.includes(b) || b.includes(a))) {
    return Math.min(1, Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.12);
  }
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function teamScore(team, windowText) {
  const target = normalize(team);
  const haystack = ocrNormalize(windowText);
  if (!target || target.length < 3 || !haystack) return 0;
  if ((" " + haystack + " ").includes(" " + target + " ")) return 1;
  const targetTokens = target.split(" ").filter(token => token.length > 1);
  const hayTokens = haystack.split(" ");
  if (!targetTokens.length) return 0;
  let matched = 0;
  for (const token of targetTokens) {
    const best = hayTokens.reduce((score, candidate) => Math.max(score, similarity(token, candidate)), 0);
    if (best >= (token.length <= 3 ? 0.86 : 0.72)) matched++;
  }
  const tokenScore = matched / targetTokens.length;
  const compactTarget = target.replace(/ /g, "");
  const compactHay = haystack.replace(/ /g, "");
  const compactScore = compactHay.includes(compactTarget) ? 1 : similarity(compactTarget, compactHay.slice(0, Math.max(compactTarget.length + 2, 1)));
  return Math.max(tokenScore, compactScore >= 0.84 ? compactScore : 0);
}

function dateBonus(fixture, text) {
  const timestamp = Number(fixture.startTimeMs);
  if (!Number.isFinite(timestamp) || !timestamp) return 0;
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const source = normalize(text);
  const numericDate = new RegExp("\\b" + String(day).padStart(2, "0") + "[ /-]" + String(month).padStart(2, "0") + "(?:[ /-]" + year + ")?\\b");
  const usDate = new RegExp("\\b" + String(month).padStart(2, "0") + "[ /-]" + String(day).padStart(2, "0") + "(?:[ /-]" + year + ")?\\b");
  const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const monthName = monthNames[date.getUTCMonth()];
  if (numericDate.test(source) || usDate.test(source) ||
      new RegExp("\\b" + monthName + "[a-z]* " + day + "\\b").test(source) ||
      new RegExp("\\b" + day + " " + monthName + "[a-z]*\\b").test(source)) return 0.10;
  return 0;
}

function timeBonus(fixture, text) {
  const timestamp = Number(fixture.startTimeMs);
  if (!Number.isFinite(timestamp) || !timestamp) return 0;
  const date = new Date(timestamp);
  const candidates = [...String(text).matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  for (const match of candidates) {
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const delta = Math.min(Math.abs(minutes - utcMinutes), 1440 - Math.abs(minutes - utcMinutes));
    if (delta <= 90) return 0.06;
  }
  return 0;
}

export function matchSnapImageFixtures(ocrText, fixtures, limit = 30) {
  const originalText = String(ocrText ?? "").slice(0, 12000);
  const lines = originalText.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
  const windows = [];
  for (let i = 0; i < lines.length; i++) {
    for (let width = 1; width <= 3 && i + width <= lines.length; width++) {
      windows.push({ text: lines.slice(i, i + width).join(" "), start: i, end: i + width - 1 });
    }
  }
  if (!windows.length && originalText.trim()) windows.push({ text: originalText, start: 0, end: 0 });
  const results = [];
  for (const fixture of Array.isArray(fixtures) ? fixtures : []) {
    const home = String(fixture.home ?? "").trim();
    const away = String(fixture.away ?? "").trim();
    if (home.length < 3 || away.length < 3) continue;
    if (/^(unknown|unknown team|sportybet|fixture unavailable)$/i.test(home) ||
        /^(unknown|unknown team|sportybet|fixture unavailable)$/i.test(away)) continue;
    let best = null;
    for (const window of windows) {
      const homeScore = teamScore(home, window.text);
      const awayScore = teamScore(away, window.text);
      const minimum = Math.min(homeScore, awayScore);
      if (minimum < 0.70) continue;
      const bonus = dateBonus(fixture, window.text) + timeBonus(fixture, window.text);
      const score = Math.min(1, (homeScore + awayScore) / 2 + bonus);
      if (!best || score > best.score) best = { ...window, score, homeScore, awayScore, bonus };
    }
    if (!best) continue;
    const confidence = Math.round(best.score * 100);
    results.push({
      fixture,
      context: lines.slice(Math.max(0, best.start - 2), Math.min(lines.length, best.end + 4)).join(" "),
      matchConfidence: confidence,
      matchMethod: best.bonus
        ? "Fuzzy team-name match with date/time support"
        : (best.homeScore === 1 && best.awayScore === 1 ? "Exact team-name match" : "Fuzzy team-name match")
    });
  }
  results.sort((a, b) => b.matchConfidence - a.matchConfidence);
  const unique = [];
  const seen = new Set();
  for (const result of results) {
    const id = String(result.fixture.eventId ?? result.fixture.id ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    unique.push(result);
    if (unique.length >= Math.max(1, limit)) break;
  }
  return unique;
}
