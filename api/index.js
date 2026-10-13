const VERSION = "0.1.0";
const TIMEOUT_MS = 4500;
const USER_AGENT = `AdiLyrics/${VERSION} (https://github.com/adidotzip/lyrics)`;

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type" }
});
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function firstString(...values) { for (const value of values) { const v = text(value); if (v) return v; } return null; }
function lyricText(data) {
  if (typeof data === "string") return data.trim() || null;
  return firstString(data?.lyrics, data?.text, data?.lrc, data?.syncedLyrics, data?.plainLyrics,
    data?.data?.lyrics, data?.data?.text, data?.data?.lrc, data?.result?.lyrics, data?.result?.text, data?.result?.lrc);
}
function normalizeLyrics(data, provider) {
  if (!data || typeof data !== "object") return null;
  const raw = lyricText(data);
  const synced = firstString(data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    data.data?.syncedLyrics, data.data?.lrc, data.result?.syncedLyrics, data.result?.lrc,
    typeof data.lyrics === "string" && /\[\d{1,2}:\d{2}/.test(data.lyrics) ? data.lyrics : null,
    typeof data.text === "string" && /\[\d{1,2}:\d{2}/.test(data.text) ? data.text : null);
  const plain = firstString(data.plainLyrics, data.plain_lyrics, data.lyricsText, data.data?.plainLyrics,
    raw && !/\[\d{1,2}:\d{2}/.test(raw) ? raw : null);
  const plainLyrics = plain && plain.length < 300000 ? plain : null;
  const syncedLyrics = synced && synced.length < 300000 ? synced : null;
  if (!plainLyrics && !syncedLyrics) return null;
  return { track: firstString(data.trackName, data.track_name, data.title, data.name, data.song),
    artist: firstString(data.artistName, data.artist_name, data.artist),
    album: firstString(data.albumName, data.album_name, data.album),
    duration: data.duration != null && Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
    instrumental: typeof data.instrumental === "boolean" ? data.instrumental : null, plainLyrics, syncedLyrics, provider };
}
async function request(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json, text/plain, */*", "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text(); if (body.length > 1000000) throw new Error("Response too large");
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json") || /^[\s]*[\[{]/.test(body)) return JSON.parse(body);
    return body;
  } finally { clearTimeout(timer); }
}
function normalizeMany(data, provider) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results : Array.isArray(data?.result) ? data.result : [data];
  return items.map(item => normalizeLyrics(item, provider)).filter(Boolean);
}
const providers = [
  { id: "lrclib", async search(q) { return normalizeMany(await request(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`), "lrclib"); },
    async exact(i) { if (!i.track || !i.artist || i.duration == null) return [];
      const p = new URLSearchParams({ track_name: i.track, artist_name: i.artist, album_name: i.album || "", duration: String(i.duration) });
      return normalizeMany(await request(`https://lrclib.net/api/get?${p}`), "lrclib"); } },
  { id: "vgjr-spotify", async search(q) { return normalizeMany(await request(`https://api.vgjr.top/lyrics/spotify?q=${encodeURIComponent(q)}`), "vgjr-spotify"); } },
  { id: "vgjr-kugou", async search(q) { return normalizeMany(await request(`https://api.vgjr.top/lyrics/kugou?q=${encodeURIComponent(q)}`), "vgjr-kugou"); } },
  { id: "vgjr-shazam", async search(q) { return normalizeMany(await request(`https://api.vgjr.top/lyrics/shazam?q=${encodeURIComponent(q)}`), "vgjr-shazam"); } },
  { id: "vgjr-tidal", async search(q) { return normalizeMany(await request(`https://api.vgjr.top/lyrics/tidal?q=${encodeURIComponent(q)}`), "vgjr-tidal"); } },
  { id: "vgjr-deezer", async search(q) { return normalizeMany(await request(`https://api.vgjr.top/lyrics/deezer?q=${encodeURIComponent(q)}`), "vgjr-deezer"); } },
  { id: "lrc-red", async search(q) {
    // lrc.red exposes ISRC-keyed resources in its published documentation.
    const isrc = q.trim().toUpperCase(); if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return [];
    const base = `https://lrc.red/s/${encodeURIComponent(isrc)}`; let meta;
    try { meta = await request(`${base}.json`); } catch {}
    const results = normalizeMany(meta, "lrc-red"); if (results.length) return results;
    const lrc = await request(`${base}.lrc`); const lyrics = typeof lrc === "string" ? lrc.trim() : lyricText(lrc);
    return lyrics ? [{ track: null, artist: null, album: null, duration: null, instrumental: null, plainLyrics: null, syncedLyrics: lyrics, provider: "lrc-red" }] : [];
  } }
];
function dedupe(items) {
  const seen = new Set(); return items.filter(item => {
    const key = (item.syncedLyrics || item.plainLyrics || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false; seen.add(key); return true;
  });
}
export default async function handler(req) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } });
  if (req.method !== "GET") return json({ error: "method_not_allowed", message: "Use GET." }, 405);
  if (["/api/health", "/health"].includes(url.pathname)) return json({ ok: true, name: "Adi Lyrics", version: VERSION, providers: providers.map(p => p.id) });
  if (!url.pathname.endsWith("/lyrics") && url.pathname !== "/api" && url.pathname !== "/") return json({ error: "not_found", message: "Try /api/lyrics?track=...&artist=..." }, 404);
  const track = text(url.searchParams.get("track") || url.searchParams.get("title"));
  const artist = text(url.searchParams.get("artist")); const album = text(url.searchParams.get("album"));
  const dp = url.searchParams.get("duration"); const duration = dp !== null && dp !== "" ? Number(dp) : null;
  const isrc = text(url.searchParams.get("isrc")); const query = text(url.searchParams.get("q")) || [track, artist].filter(Boolean).join(" ");
  const providerFilter = text(url.searchParams.get("provider")); const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 10, 20));
  if (!query && !isrc) return json({ error: "missing_query", message: "Provide q or track. Optional: artist, album, duration, isrc, provider, limit." }, 400);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 3600)) return json({ error: "invalid_duration", message: "duration must be between 0 and 3600 seconds." }, 400);
  const selected = providers.filter(p => !providerFilter || p.id === providerFilter);
  if (providerFilter && !selected.length) return json({ error: "unknown_provider", providers: providers.map(p => p.id) }, 400);
  const input = { track, artist, album, duration };
  const settled = await Promise.allSettled(selected.map(async p => {
    let results = []; if (p.id === "lrclib" && track && artist && duration !== null) results = await p.exact(input);
    if (!results.length) results = await p.search(p.id === "lrc-red" && isrc ? isrc : (query || isrc));
    return { count: results.length, results };
  }));
  const statuses = settled.map((r, i) => r.status === "fulfilled" ? { provider: selected[i].id, ok: true, count: r.value.count } :
    { provider: selected[i].id, ok: false, error: r.reason?.name === "AbortError" ? "timeout" : "unavailable" });
  const results = dedupe(settled.flatMap(r => r.status === "fulfilled" ? r.value.results : [])).slice(0, limit);
  return json({ api: "Adi Lyrics", version: VERSION, query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null }, found: results.length > 0, count: results.length, results, providers: statuses });
}