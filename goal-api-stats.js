// GOAL API form adapter. All requests are server-side; the API key is never returned.
const BASE = "https://api.goal-api.com/v1";
const TEAM_TTL = 24 * 60 * 60 * 1000;
const RESULTS_TTL = 6 * 60 * 60 * 1000;
const TIMEOUT = 8000;
const cache = new Map();
const pending = new Map();

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and")
    .replace(/\b(fc|cf|sc|afc|club|football club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function score(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function finished(row) {
  return /finished|full.?time|after.?et|after.?pen|^ft$/i.test(String(row?.matchStatus || row?.status || ""));
}
function cacheGet(key, ttl) {
  const item = cache.get(key);
  return item && Date.now() - item.at < ttl ? item.value : undefined;
}
async function fetchJson(url) {
  const apiKey = process.env.GOAL_API_KEY || "";
  if (!apiKey) throw new Error("GOAL_API_KEY is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + apiKey },
      signal: controller.signal
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) throw new Error(body?.message || body?.error || ("GOAL API HTTP " + response.status));
    if (!body || body.success === false) throw new Error(body?.message || "GOAL API returned invalid data");
    return body;
  } finally {
    clearTimeout(timer);
  }
}
async function cachedFetch(key, ttl, url) {
  const hit = cacheGet(key, ttl);
  if (hit !== undefined) return { value: hit, cached: true };
  if (pending.has(key)) return { value: await pending.get(key), cached: true };
  const task = fetchJson(url).then(body => {
    const value = body?.data ?? null;
    cache.set(key, { at: Date.now(), value });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return { value: await task, cached: false };
}
async function findTeamId(teamName) {
  const normalized = norm(teamName);
  if (!normalized) return null;
  const key = "goal-team:" + normalized;
  const hit = cacheGet(key, TEAM_TTL);
  if (hit !== undefined) return hit;
  const result = await cachedFetch(key, TEAM_TTL,
    BASE + "/teams?search=" + encodeURIComponent(teamName) + "&limit=10&offset=0");
  const teams = Array.isArray(result.value) ? result.value : [];
  const exact = teams.filter(team => norm(team.name) === normalized);
  let selected = exact.length === 1 ? exact[0] : null;
  if (!selected && exact.length === 0) {
    const partial = teams.filter(team => {
      const candidate = norm(team.name);
      return candidate.length >= 4 && normalized.length >= 4 &&
        (candidate.includes(normalized) || normalized.includes(candidate));
    });
    // Never guess between ambiguous similarly named teams.
    if (partial.length === 1) selected = partial[0];
  }
  const id = selected?.id ? String(selected.id) : null;
  cache.set(key, { at: Date.now(), value: id });
  return id;
}
function summarizeTeamResults(rows, teamId, teamName, cutoffDate) {
  const nameKey = norm(teamName);
  const completed = (Array.isArray(rows) ? rows : []).filter(row => {
    const date = String(row.matchDate || row.date || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoffDate && finished(row);
  }).map(row => {
    const homeId = String(row.homeTeamId || row.homeTeam?.id || "");
    const awayId = String(row.awayTeamId || row.awayTeam?.id || "");
    const homeName = String(row.homeTeamName || row.homeTeam?.name || "");
    const awayName = String(row.awayTeamName || row.awayTeam?.name || "");
    const isHome = homeId && teamId ? homeId === teamId : norm(homeName) === nameKey;
    const isAway = awayId && teamId ? awayId === teamId : norm(awayName) === nameKey;
    if (isHome === isAway) return null;
    const homeScore = score(row.homeTeamFtScore ?? row.homeTeamScore ?? row.homeScore);
    const awayScore = score(row.awayTeamFtScore ?? row.awayTeamScore ?? row.awayScore);
    if (homeScore === null || awayScore === null) return null;
    return {
      date,
      goalsFor: isHome ? homeScore : awayScore,
      goalsAgainst: isHome ? awayScore : homeScore,
      totalGoals: homeScore + awayScore,
      won: (isHome && homeScore > awayScore) || (isAway && awayScore > homeScore),
      drawn: homeScore === awayScore,
      lost: (isHome && homeScore < awayScore) || (isAway && awayScore < homeScore),
      btts: homeScore > 0 && awayScore > 0
    };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (!completed.length) return null;
  const n = completed.length;
  const rate = predicate => completed.filter(predicate).length / n;
  return {
    matches: n,
    goalsFor: completed.reduce((sum, item) => sum + item.goalsFor, 0) / n,
    goalsAgainst: completed.reduce((sum, item) => sum + item.goalsAgainst, 0) / n,
    winRate: rate(x => x.won),
    drawRate: rate(x => x.drawn),
    lossRate: rate(x => x.lost),
    over15Rate: rate(x => x.totalGoals >= 2),
    over25Rate: rate(x => x.totalGoals >= 3),
    bttsRate: rate(x => x.btts),
    latestMatchDate: completed[0].date
  };
}
async function getTeamResults(teamId) {
  const key = "goal-results:" + teamId;
  const hit = cacheGet(key, RESULTS_TTL);
  if (hit !== undefined) return { rows: hit, cached: true };
  const result = await cachedFetch(key, RESULTS_TTL,
    BASE + "/teams/" + encodeURIComponent(teamId) + "/results?limit=20&offset=0");
  return { rows: Array.isArray(result.value) ? result.value : [], cached: result.cached };
}
export async function getGoalApiTeamForm(homeName, awayName, cutoffDate) {
  if (!process.env.GOAL_API_KEY) {
    return { available: false, error: "GOAL_API_KEY is not configured", home: null, away: null };
  }
  try {
    const [homeId, awayId] = await Promise.all([findTeamId(homeName), findTeamId(awayName)]);
    if (!homeId || !awayId) {
      return { available: false, error: "Could not safely match both teams to GOAL API IDs", home: null, away: null };
    }
    const [homeResults, awayResults] = await Promise.all([getTeamResults(homeId), getTeamResults(awayId)]);
    const home = summarizeTeamResults(homeResults.rows, homeId, homeName, cutoffDate);
    const away = summarizeTeamResults(awayResults.rows, awayId, awayName, cutoffDate);
    if (!home || !away) {
      return { available: false, error: "Insufficient completed GOAL API results before fixture date", home, away };
    }
    return {
      available: true, error: null, home, away,
      cached: homeResults.cached && awayResults.cached,
      sampleSize: Math.min(home.matches, away.matches)
    };
  } catch (error) {
    return { available: false, error: error?.message || "GOAL API form lookup failed", home: null, away: null };
  }
}
export async function checkGoalApiStatsHealth() {
  if (!process.env.GOAL_API_KEY) return { available: false, configured: false, count: 0, error: "GOAL_API_KEY is not configured" };
  try {
    const result = await cachedFetch("goal-stats-health", 5 * 60 * 1000,
      BASE + "/teams?limit=1&offset=0");
    return { available: Array.isArray(result.value), configured: true, count: Array.isArray(result.value) ? result.value.length : 0, error: null, cached: result.cached };
  } catch (error) {
    return { available: false, configured: true, count: 0, error: error?.message || "GOAL API health check failed" };
  }
}
