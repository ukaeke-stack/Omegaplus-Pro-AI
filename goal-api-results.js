// GOAL API secondary football results provider. API key stays server-side.
const BASE = "https://api.goal-api.com/v1";
const cache = new Map();
const TTL = 15000;

function norm(v) {
  return String(v || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function dayKey(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
function statusOf(m) {
  const raw = String(m?.matchStatus || m?.status || m?.matchPeriod || "").toLowerCase();
  if (/postpon/.test(raw)) return "Postponed";
  if (/cancel|abandon|void/.test(raw)) return "Void";
  if (/finished|full.?time|^ft$|ended|complete|after.?time|penalt/.test(raw)) return "Finished";
  if (/live|in.?play|first.?half|second.?half|half.?time|extra.?time|period/.test(raw)) return "Live";
  return "Pending";
}
function score(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
async function fetchJson(url, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + key },
      signal: controller.signal
    });
    const bodyText = await res.text();
    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch {}
    if (!res.ok) throw new Error(body?.message || body?.error || ("GOAL API HTTP " + res.status));
    if (!body || body.success === false) throw new Error(body?.message || "GOAL API returned invalid data");
    return body;
  } finally { clearTimeout(timer); }
}
export async function getGoalApiDateResults(date, force = false) {
  const key = process.env.GOAL_API_KEY || "";
  if (!key) return { configured: false, data: [], error: "GOAL_API_KEY is not configured." };
  const cacheKey = "goal-api:" + date;
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < TTL) return { configured: true, data: hit.data, cached: true, updatedAt: hit.at };
  const body = await fetchJson(BASE + "/fixtures/date/" + encodeURIComponent(date), key);
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.results) ? body.results : [];
  const data = rows.map(m => {
    const kickoff = Date.parse(m.kickoffUtc || m.startingAt || m.starting_at || "");
    const home = String(m.homeTeamName || m.homeTeam?.name || m.home || "");
    const away = String(m.awayTeamName || m.awayTeam?.name || m.away || "");
    if (!home || !away) return null;
    return {
      providerId: String(m.id || m.fixtureId || "goal-api:" + home + ":" + away),
      date: Number.isFinite(kickoff) ? dayKey(kickoff) : date,
      startingAt: Number.isFinite(kickoff) ? Math.floor(kickoff / 1000) : null,
      home, away, homeKey: norm(home), awayKey: norm(away),
      homeScore: score(m.homeTeamScore ?? m.homeScore ?? m.home_score),
      awayScore: score(m.awayTeamScore ?? m.awayScore ?? m.away_score),
      status: statusOf(m), state: String(m.matchStatus || m.status || m.matchPeriod || ""),
      league: String(m.leagueName || m.league?.name || ""),
      country: String(m.countryName || m.country?.name || ""),
      sources: ["GOAL API"]
    };
  }).filter(Boolean);
  cache.set(cacheKey, { at: Date.now(), data });
  return { configured: true, data, cached: false, updatedAt: Date.now() };
}
