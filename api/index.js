const VERSION = "0.1.0";
const TIMEOUT_MS = 4500;
const USER_AGENT = `AdiLyrics/${VERSION} (https://github.com/adidotzip/lyrics)`;

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  }
});

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function firstString(...values) {
  for (const value of values) { const result = text(value); if (result) return result; }
  return null;
}

function lyricText(data) {
  if (typeof data === "string") return data.trim() || null;
  return firstString(data?.lyrics, data?.text, data?.lrc, data?.syncedLyrics, data?.plainLyrics,
    data?.data?.lyrics, data?.data?.text, data?.data?.lrc, data?.result?.lyrics, data?.result?.text,
    data?.result?.lrc, data?.result?.syncedLyrics);
}

function normalizeLyrics(data, provider) {
  if (!data || typeof data !== "object") return null;
  const rawLyrics = lyricText(data);
  const syncedLyrics = firstString(data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    data.lyrics?.syncedLyrics, data.data?.syncedLyrics, data.data?.lrc, data.result?.syncedLyrics,
    data.result?.lrc,
    typeof data.lyrics === "string" && /\[\d{1,2}:\d{2}/.test(data.lyrics) ? data.lyrics : null,
    typeof data.text === "string" && /\[\d{1,2}:\d{2}/.test(data.text) ? data.text : null);
  const plainLyrics = firstString(data.plainLyrics, data.plain_lyrics, data.lyricsText,
    data.data?.plainLyrics, data.result?.plainLyrics,
    rawLyrics && !/\[\d{1,2}:\d{2}/.test(rawLyrics) ? rawLyrics : null);
  const cleanPlain = plainLyrics && plainLyrics.length < 300000 ? plainLyrics : null;
  const cleanSynced = syncedLyrics && syncedLyrics.length < 300000 ? syncedLyrics : null;
  if (!cleanPlain && !cleanSynced) return null;
  return {
    track: firstString(data.trackName, data.track_name, data.title, data.name, data.song),
    artist: firstString(data.artistName, data.artist_name, data.artist),
    album: firstString(data.albumName, data.album_name, data.album),
    duration: data.duration != null && Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
    instrumental: typeof data.instrumental === "boolean" ? data.instrumental : null,
    plainLyrics: cleanPlain, syncedLyrics: cleanSynced, provider
  };
}

async function request(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: {
      "accept": "application/json, text/plain, */*", "user-agent": USER_AGENT
    }});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 1000000) throw new Error("Provider response too large");
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || /^[\s]*[\[{]/.test(body)) return JSON.parse(body);
    return body;
  } finally { clearTimeout(timeout); }
}

function normalizeMany(data, provider) {
  const candidates = Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results :
    Array.isArray(data?.result) ? data.result : [data];
  return candidates.map(item => normalizeLyrics(item, provider)).filter(Boolean);
}

const providers = [
  { id: "lrclib", async search(q) {
    return normalizeMany(await request(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`), "lrclib");
  }, async exact(input) {
    if (!input.track || !input.artist || input.duration == null) return [];
    const params = new URLSearchParams({ track_name: input.track, artist_name: input.artist,
      album_name: input.album || "", duration: String(input.duration) });
    return normalizeMany(await request(`https://lrclib.net/api/get?${params}`), "lrclib");
  }},
  { id: "vgjr-spotify", async search(q) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/spotify?q=${encodeURIComponent(q)}`), "vgjr-spotify");
  }},
  { id: "vgjr-kugou", async search(q) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/kugou?q=${encodeURIComponent(q)}`), "vgjr-kugou");
  }},
  { id: "vgjr-shazam", async search(q) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/shazam?q=${encodeURIComponent(q)}`), "vgjr-shazam");
  }},
  { id: "vgjr-tidal", async search(q) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/tidal?q=${encodeURIComponent(q)}`), "vgjr-tidal");
  }},
  { id: "vgjr-deezer", async search(q) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/deezer?q=${encodeURIComponent(q)}`), "vgjr-deezer");
  }},
  { id: "lrc-red", async search(q) {
    // lrc.red documents static, ISRC-keyed resources rather than free-text search.
    const isrc = q.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return [];
    const base = `https://lrc.red/s/${encodeURIComponent(isrc)}`;
    let metadata;
    try { metadata = await request(`${base}.json`); } catch {}
    const fromMetadata = normalizeMany(metadata, "lrc-red");
    if (fromMetadata.length) return fromMetadata;
    const raw = await request(`${base}.lrc`);
    const lyrics = typeof raw === "string" ? raw.trim() : lyricText(raw);
    return lyrics ? [{ track: null, artist: null, album: null, duration: null, instrumental: null,
      plainLyrics: null, syncedLyrics: lyrics, provider: "lrc-red" }] : [];
  }}
];

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = (item.syncedLyrics || item.plainLyrics || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  }});
  if (req.method !== "GET") return json({ error: "method_not_allowed", message: "Use GET." }, 405);
  if (url.pathname === "/api/health" || url.pathname === "/health")
    return json({ ok: true, name: "Adi Lyrics", version: VERSION, providers: providers.map(p => p.id) });
  if (!url.pathname.endsWith("/lyrics") && url.pathname !== "/api" && url.pathname !== "/")
    return json({ error: "not_found", message: "Try /api/lyrics?track=...&artist=..." }, 404);

  const track = text(url.searchParams.get("track") || url.searchParams.get("title"));
  const artist = text(url.searchParams.get("artist"));
  const album = text(url.searchParams.get("album"));
  const durationParam = url.searchParams.get("duration");
  const duration = durationParam !== null && durationParam !== "" ? Number(durationParam) : null;
  const isrc = text(url.searchParams.get("isrc"));
  const query = text(url.searchParams.get("q")) || [track, artist].filter(Boolean).join(" ");
  const providerFilter = text(url.searchParams.get("provider"));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 10, 20));
  if (!query && !isrc) return json({ error: "missing_query",
    message: "Provide q or track. Optional parameters: artist, album, duration (seconds), isrc, provider, limit." }, 400);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 3600))
    return json({ error: "invalid_duration", message: "duration must be between 0 and 3600 seconds." }, 400);

  const input = { track, artist, album, duration };
  const selected = providers.filter(p => !providerFilter || p.id === providerFilter);
  if (providerFilter && selected.length === 0)
    return json({ error: "unknown_provider", providers: providers.map(p => p.id) }, 400);

  const settled = await Promise.allSettled(selected.map(async provider => {
    let results = [];
    if (provider.id === "lrclib" && track && artist && duration !== null) results = await provider.exact(input);
    if (results.length === 0) results = await provider.search(provider.id === "lrc-red" && isrc ? isrc : (query || isrc));
    return { provider: provider.id, count: results.length, results };
  }));
  const statuses = settled.map((result, index) => result.status === "fulfilled"
    ? { provider: selected[index].id, ok: true, count: result.value.count }
    : { provider: selected[index].id, ok: false, error: result.reason?.name === "AbortError" ? "timeout" : "unavailable" });
  const results = dedupe(settled.flatMap(result => result.status === "fulfilled" ? result.value.results : [])).slice(0, limit);
  return json({ api: "Adi Lyrics", version: VERSION,
    query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null },
    found: results.length > 0, count: results.length, results, providers: statuses });
}
