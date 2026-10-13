const VERSION = "0.2.1";
const TIMEOUT_MS = 5000;
const USER_AGENT = `AdiLyrics/${VERSION} (https://github.com/adidotzip/lyrics)`;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};
const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300" }
});

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function firstString(...values) {
  for (const value of values) { const result = text(value); if (result) return result; }
  return null;
}
function xmlDecode(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function ttmlToText(ttml) {
  const lines = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(ttml)) !== null) {
    const line = xmlDecode(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines.length ? lines.join("\n") : xmlDecode(ttml.replace(/<[^>]*>/g, "")).trim();
}
function inferSyncLevel(ttml) {
  if (!ttml) return "none";
  if (/<span\b[^>]*(?:begin|end)=/i.test(ttml)) return "word";
  if (/<p\b[^>]*(?:begin|end)=/i.test(ttml)) return "line";
  return "none";
}
function normalizeLyrics(data, provider, formatHint = null) {
  if (typeof data === "string") {
    const raw = data.trim();
    if (!raw) return null;
    if (/<tt\b/i.test(raw)) return {
      track: null, artist: null, album: null, duration: null, instrumental: null,
      plainLyrics: ttmlToText(raw), syncedLyrics: null, ttml: raw, format: "ttml",
      syncLevel: inferSyncLevel(raw), provider
    };
    const isLrc = /\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(raw);
    return {
      track: null, artist: null, album: null, duration: null, instrumental: null,
      plainLyrics: isLrc ? null : raw, syncedLyrics: isLrc ? raw : null, ttml: null,
      format: isLrc ? "lrc" : (formatHint || "plain"), syncLevel: isLrc ? "line" : "none", provider
    };
  }
  if (!data || typeof data !== "object") return null;
  const nested = data.data && typeof data.data === "object" ? data.data : null;
  const ttml = firstString(data.ttml, data.lyricsTtml, nested?.ttml,
    typeof data.lyrics === "string" && /<tt\b/i.test(data.lyrics) ? data.lyrics : null,
    typeof nested?.lyrics === "string" && /<tt\b/i.test(nested.lyrics) ? nested.lyrics : null);
  const syncLyrics = Array.isArray(data.syncLyrics) ? data.syncLyrics : Array.isArray(nested?.syncLyrics) ? nested.syncLyrics : null;
  const candidates = [
    data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    typeof data.lyrics === "string" && !/<tt\b/i.test(data.lyrics) ? data.lyrics : null,
    data.text, data.plainLyrics, data.plain_lyrics, data.lyricsText,
    nested?.syncedLyrics, nested?.lrc, nested?.lyrics, nested?.text, nested?.plainLyrics,
    data.result?.syncedLyrics, data.result?.lrc, data.result?.lyrics, data.result?.text
  ];
  const raw = firstString(...candidates);
  const synced = firstString(data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    nested?.syncedLyrics, nested?.lrc, data.result?.syncedLyrics, data.result?.lrc,
    raw && /\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(raw) ? raw : null);
  const plain = firstString(data.plainLyrics, data.plain_lyrics, data.lyricsText, nested?.plainLyrics,
    raw && !/<tt\b/i.test(raw) && !/\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(raw) ? raw : null);
  const cleanTtml = ttml && ttml.length < 500000 ? ttml : null;
  const cleanSynced = synced && synced.length < 300000 ? synced : null;
  const cleanPlain = plain && plain.length < 300000 ? plain : null;
  if (!cleanTtml && !cleanSynced && !cleanPlain) return null;
  const format = cleanTtml ? "ttml" : cleanSynced ? "lrc" : (formatHint || "plain");
  return {
    track: firstString(data.trackName, data.track_name, data.title, data.name, data.song, data.musicName, data.musicNames?.[0], nested?.song, nested?.trackName, nested?.title, nested?.name),
    artist: firstString(data.artistName, data.artist_name, data.artist, data.artists?.[0]?.name, data.artists?.[0], data.artistNames?.[0], nested?.artist, nested?.artists?.map?.(item => item?.name).filter(Boolean).join(", ")),
    album: firstString(data.albumName, data.album_name, data.album, data.albumNames?.[0], nested?.album, nested?.albumName),
    duration: (() => { const value = data.duration ?? nested?.duration; const n = Number(value); return value != null && Number.isFinite(n) ? (n > 3600 ? n / 1000 : n) : null; })(),
    instrumental: typeof data.instrumental === "boolean" ? data.instrumental : null,
    plainLyrics: cleanTtml ? (cleanPlain || ttmlToText(cleanTtml)) : cleanPlain,
    syncedLyrics: cleanSynced,
    // LRCLIB's lyricsfile may contain word-level timing not present in plain LRC.
    lyricsfile: firstString(data.lyricsfile, data.lyrics_file, data.data?.lyricsfile),
    hasWordSync: typeof data.hasWordSync === "boolean" ? data.hasWordSync :
      (syncLyrics ? syncLyrics.some(line => Array.isArray(line?.syllables) && line.syllables.length > 0) : null),
    syncLyrics,
    ttml: cleanTtml,
    format,
    syncLevel: cleanTtml ? inferSyncLevel(cleanTtml) :
      (data.hasWordSync === true && firstString(data.lyricsfile, data.lyrics_file, data.data?.lyricsfile) ? "word" :
      syncLyrics?.some(line => Array.isArray(line?.syllables) && line.syllables.length) ? "word" :
      (syncLyrics?.some(line => line?.startTimeMs != null && typeof line?.words === "string") ? "line" :
      (cleanSynced ? "line" : "none"))),
    provider
  };
}
async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: {
      accept: "application/json, text/plain, */*", "user-agent": USER_AGENT
    }});
    const body = await response.text();
    if (body.length > 1500000) throw new Error("Provider response too large");
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json") || /^[\s]*[\[{]/.test(body)) return JSON.parse(body);
    return body;
  } finally { clearTimeout(timer); }
}
function normalizeMany(data, provider, formatHint = null) {
  if (data?.success === false) return [];
  const source = data?.data ?? data;
  const candidates = Array.isArray(source) ? source
    : Array.isArray(source?.items) ? source.items
    : Array.isArray(source?.results) ? source.results
    : Array.isArray(source?.result) ? source.result
    : [source];
  return candidates.map(item => normalizeLyrics(item, provider, formatHint)).filter(Boolean);
}
function normalizedKey(value) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function titleArtistScore(result, input) {
  const title = normalizedKey(result.track || "");
  const artist = normalizedKey(result.artist || "");
  const album = normalizedKey(result.album || "");
  const wantedTitle = normalizedKey(input.track || "");
  const wantedArtist = normalizedKey(input.artist || "");
  const wantedAlbum = normalizedKey(input.album || "");
  let score = 0;
  if (wantedTitle && title) score += title === wantedTitle ? 8 :
    (title.includes(wantedTitle) || wantedTitle.includes(title) ? 3 : -10);
  if (wantedArtist && artist) score += artist === wantedArtist ? 7 :
    (artist.includes(wantedArtist) || wantedArtist.includes(artist) ? 3 : -10);
  if (wantedAlbum && album) score += album === wantedAlbum ? 2 :
    (album.includes(wantedAlbum) || wantedAlbum.includes(album) ? 1 : -2);
  if (input.duration != null && result.duration != null) {
    const delta = Math.abs(Number(input.duration) - Number(result.duration));
    score += delta <= 2 ? 3 : delta <= 5 ? 1 : -Math.min(6, delta);
  }
  // A higher sync level is a tie-breaker, never a substitute for an identity match.
  score += result.syncLevel === "word" ? 1.5 : result.syncLevel === "line" ? 0.5 : 0;
  return score;
}

const providers = [
  { id: "lrclib", async search(input) {
    if (input.track && input.artist && input.duration != null) {
      const params = new URLSearchParams({ track_name: input.track, artist_name: input.artist,
        album_name: input.album || "", duration: String(Math.round(input.duration)) });
      try {
        const exact = normalizeMany(await request(`https://lrclib.net/api/get?${params}`), "lrclib");
        if (exact.length) return exact;
      } catch {}
    }
    const params = new URLSearchParams();
    if (input.track) params.set("track_name", input.track);
    if (input.artist) params.set("artist_name", input.artist);
    if (input.album) params.set("album_name", input.album);
    if (!params.size) params.set("q", input.query);
    return normalizeMany(await request(`https://lrclib.net/api/search?${params}`), "lrclib");
  }},
  { id: "betterlyrics", async search(input) {
    if (!input.track || !input.artist || input.duration == null) return [];
    const params = new URLSearchParams({ s: input.track, a: input.artist,
      al: input.album || input.track, d: String(Math.round(input.duration)) });
    const data = await request(`https://api.betterlyrics.org/getLyrics?${params}`);
    if (!data?.ttml) return [];
    return normalizeMany({ ...data, trackName: input.track, artistName: input.artist,
      albumName: input.album }, "betterlyrics").map(item => ({
        ...item, confidence: typeof data.score === "number" ? data.score : null
      }));
  }},
  { id: "unison", async search(input) {
    if (!input.track || !input.artist) return [];
    const params = new URLSearchParams({ song: input.track, artist: input.artist });
    if (input.album) params.set("album", input.album);
    if (input.duration != null) params.set("duration", String(Math.round(input.duration)));
    const exact = await request(`https://unison.boidu.dev/lyrics?${params}`);
    if (exact?.success && exact.data?.lyrics) {
      return normalizeMany({ ...exact.data, trackName: exact.data.song, artistName: exact.data.artist,
        albumName: exact.data.album, lyrics: exact.data.lyrics }, "unison", exact.data.format)
        .map(item => ({ ...item, confidence: exact.data.confidence || null,
          matchScore: exact.data.effectiveScore ?? exact.data.score ?? null }));
    }
    return [];
  }},
  { id: "amll-ttml-db", async search(input) {
    const params = new URLSearchParams();
    if (input.track) params.set("musicName", input.track);
    if (input.artist) params.set("artistName", input.artist);
    if (input.album) params.set("albumName", input.album);
    if (!params.size && input.query) params.set("q", input.query);
    if (!params.size && input.isrc) params.set("isrc", input.isrc);
    if (!params.size) return [];
    const search = await request(`https://api.amll.dev/v1/lyrics/search?${params}`);
    const items = search?.data?.items ?? search?.items ?? [];
    if (!Array.isArray(items)) return [];
    const settled = await Promise.allSettled(items.slice(0, 3).map(async candidate => {
      if (!candidate.id && !candidate.filename) return [];
      const id = new URLSearchParams(candidate.id ? { id: String(candidate.id) } : { filename: candidate.filename });
      const result = await request(`https://api.amll.dev/v1/lyrics/get?${id}`);
      if (result?.status !== 200 || !result.data?.lyrics) return [];
      const metadata = result.data;
      return normalizeMany({ ...metadata, trackName: metadata.musicNames?.[0],
        artistName: metadata.artists?.[0], albumName: metadata.albumNames?.[0],
        ttml: metadata.lyrics }, "amll-ttml-db");
    }));
    return settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
  }},
  { id: "vgjr-spotify", async search(input) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/spotify?q=${encodeURIComponent(input.query)}`), "vgjr-spotify");
  }},
  { id: "vgjr-kugou", async search(input) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/kugou?q=${encodeURIComponent(input.query)}`), "vgjr-kugou");
  }},
  { id: "vgjr-shazam", async search(input) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/shazam?q=${encodeURIComponent(input.query)}`), "vgjr-shazam");
  }},
  { id: "vgjr-tidal", async search(input) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/tidal?q=${encodeURIComponent(input.query)}`), "vgjr-tidal");
  }},
  { id: "vgjr-deezer", async search(input) {
    return normalizeMany(await request(`https://api.vgjr.top/lyrics/deezer?q=${encodeURIComponent(input.query)}`), "vgjr-deezer");
  }},
  { id: "popcat", fallbackOnly: true, async search(input) {
    const data = await request(`https://api.popcat.xyz/v2/lyrics?song=${encodeURIComponent(input.query || input.track)}`);
    return normalizeMany(data, "popcat");
  }},
  { id: "lrc-red", async search(input) {
    const isrc = text(input.isrc).toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return [];
    const base = `https://lrc.red/s/${encodeURIComponent(isrc)}`;
    let meta;
    try { meta = await request(`${base}.json`); } catch {}
    const found = normalizeMany(meta, "lrc-red");
    if (found.length) return found;
    const raw = await request(`${base}.lrc`);
    const lyrics = typeof raw === "string" ? raw.trim() : null;
    return lyrics ? normalizeMany(lyrics, "lrc-red") : [];
  }}
];

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const body = item.ttml || item.syncedLyrics || item.plainLyrics || "";
    const key = body.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function handle(req) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed", message: "Use GET." }, 405);
  if (["/api/health", "/health"].includes(url.pathname)) return json({
    ok: true, name: "Adi Lyrics", version: VERSION, providers: providers.map(p => p.id),
    syncPreference: ["word", "line", "plain"]
  });
  if (!url.pathname.endsWith("/lyrics") && url.pathname !== "/api" && url.pathname !== "/")
    return json({ error: "not_found", message: "Try /api/lyrics?track=...&artist=..." }, 404);

  const track = text(url.searchParams.get("track") || url.searchParams.get("title"));
  const artist = text(url.searchParams.get("artist"));
  const album = text(url.searchParams.get("album"));
  const durationValue = url.searchParams.get("duration");
  const duration = durationValue !== null && durationValue !== "" ? Number(durationValue) : null;
  const isrc = text(url.searchParams.get("isrc"));
  const query = text(url.searchParams.get("q")) || [track, artist].filter(Boolean).join(" ");
  const provider = text(url.searchParams.get("provider"));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 10, 20));
  const prefer = text(url.searchParams.get("prefer")) || "word";
  if (!query && !isrc) return json({ error: "missing_query", message: "Provide q or track. Optional: artist, album, duration, isrc, provider, limit, prefer." }, 400);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 3600))
    return json({ error: "invalid_duration", message: "duration must be between 0 and 3600 seconds." }, 400);
  if (!["word", "line", "plain", "best"].includes(prefer))
    return json({ error: "invalid_prefer", message: "prefer must be word, line, plain, or best." }, 400);
  const selected = providers.filter(p => !provider || p.id === provider).filter(p => provider || !p.fallbackOnly);
  if (provider && !selected.length) return json({ error: "unknown_provider", providers: providers.map(p => p.id) }, 400);
  const input = { track, artist, album, duration, isrc, query };
  const settled = await Promise.allSettled(selected.map(async p => {
    const results = await p.search(input);
    return { results, count: results.length };
  }));
  let statuses = settled.map((r, i) => r.status === "fulfilled"
    ? { provider: selected[i].id, ok: true, count: r.value.count }
    : { provider: selected[i].id, ok: false,
        error: r.reason?.name === "AbortError" ? "timeout" : r.reason?.status === 429 ? "rate_limited" : "unavailable",
        retryAfter: r.reason?.retryAfter || null });
  let results = dedupe(settled.flatMap(r => r.status === "fulfilled" ? r.value.results : []));
  results = results.map(result => ({ ...result, matchScore: titleArtistScore(result, input) }));
  // Metadata mismatches are excluded when the caller provides both title and artist.
  if (track && artist) results = results.filter(result => result.matchScore >= 0);
  // Popcat is deliberately last-resort, after matching has rejected any wrong-track results.
  if (!results.length && !provider) {
    try {
      results = dedupe(await providers.find(p => p.id === "popcat").search(input))
        .map(result => ({ ...result, matchScore: titleArtistScore(result, input) }));
      statuses = [...statuses, { provider: "popcat", ok: results.length > 0, count: results.length, fallback: true }];
    } catch {
      statuses = [...statuses, { provider: "popcat", ok: false, error: "unavailable", fallback: true }];
    }
    if (track && artist) results = results.filter(result => result.matchScore >= 0);
  }
  const preferenceBonus = result => prefer === "best" ? 0 :
    prefer === "word" ? (result.syncLevel === "word" ? 2.5 : result.syncLevel === "line" ? 0.5 : 0) :
    prefer === "line" ? (result.syncLevel === "line" ? 2 : result.syncLevel === "word" ? 1 : 0) :
    (result.syncLevel === "none" ? 2 : 0);
  results.sort((a, b) => {
    // Correct track identity and source confidence outweigh the sync format.
    const confidenceA = typeof a.confidence === "number" ? a.confidence * 2 : 0;
    const confidenceB = typeof b.confidence === "number" ? b.confidence * 2 : 0;
    return (b.matchScore + preferenceBonus(b) + confidenceB) -
      (a.matchScore + preferenceBonus(a) + confidenceA);
  });
  results = results.slice(0, limit);
  return json({ api: "Adi Lyrics", version: VERSION,
    query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null },
    preference: prefer, found: results.length > 0, count: results.length, best: results[0] || null, results, providers: statuses });
}


// Vercel Node.js functions use the Node request/response interface.
// Adapt the Fetch-style internal response to Node's ServerResponse.
export default async function handler(req, res) {
  try {
    const response = await handle(req);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  } catch (error) {
    console.error("Adi Lyrics handler failed:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("access-control-allow-origin", "*");
    }
    res.end(JSON.stringify({ error: "internal_error", message: "The lyrics API encountered an unexpected error." }));
  }
}
