const VERSION = "0.2.0";
const TIMEOUT_MS = 5000;
const USER_AGENT = `AdiLyrics/${VERSION} (https://github.com/adidotzip/lyrics)`;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};
const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    ...cors,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300"
  }
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function firstString(...values) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return null;
}
function parseTime(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/s$/, "");
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return null;
}
function xmlDecode(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function stripMarkup(value) {
  return xmlDecode(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// Keep the original rich format and also provide a plain-text preview for generic clients.
function ttmlToText(ttml) {
  const lines = [];
  const paragraphRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = paragraphRegex.exec(ttml)) !== null) {
    const line = stripMarkup(match[2]);
    if (line) lines.push(line);
  }
  if (lines.length) return lines.join("\n");
  return stripMarkup(ttml);
}
function hasWordTiming(ttml) {
  return /<span\b[^>]*(?:begin|end)=/i.test(ttml);
}
function normalizeLyrics(data, provider, formatHint = null, extra = {}) {
  if (typeof data === "string") {
    const raw = data.trim();
    if (!raw) return null;
    if (/<tt\b|<tt:tt\b/i.test(raw)) {
      return {
        track: null, artist: null, album: null, duration: null, instrumental: null,
        plainLyrics: ttmlToText(raw), syncedLyrics: null, ttml: raw,
        format: "ttml", syncLevel: hasWordTiming(raw) ? "word" : "line",
        provider, ...extra
      };
    }
    return {
      track: null, artist: null, album: null, duration: null, instrumental: null,
      plainLyrics: /\[\d{1,2}:\d{2}/.test(raw) ? null : raw,
      syncedLyrics: /\[\d{1,2}:\d{2}/.test(raw) ? raw : null,
      ttml: null, format: /\[\d{1,2}:\d{2}/.test(raw) ? "lrc" : "plain",
      syncLevel: /\[\d{1,2}:\d{2}/.test(raw) ? "line" : "none", provider, ...extra
    };
  }
  if (!data || typeof data !== "object") return null;

  const ttml = firstString(data.ttml, data.lyrics?.ttml, data.data?.ttml, data.result?.ttml,
    data.lyrics && typeof data.lyrics === "string" && /<tt\b/i.test(data.lyrics) ? data.lyrics : null,
    data.data?.lyrics && typeof data.data.lyrics === "string" && /<tt\b/i.test(data.data.lyrics) ? data.data.lyrics : null,
    data.result?.lyrics && typeof data.result.lyrics === "string" && /<tt\b/i.test(data.result.lyrics) ? data.result.lyrics : null);
  const raw = firstString(data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    typeof data.lyrics === "string" && !/<tt\b/i.test(data.lyrics) ? data.lyrics : null,
    typeof data.text === "string" ? data.text : null,
    data.data?.syncedLyrics, data.data?.lrc, data.data?.lyrics,
    data.result?.syncedLyrics, data.result?.lrc, data.result?.lyrics,
    data.plainLyrics, data.plain_lyrics, data.lyricsText, data.data?.plainLyrics);
  const syncedLyrics = firstString(data.syncedLyrics, data.synced_lyrics, data.lrc, data.lrcLyrics,
    data.data?.syncedLyrics, data.data?.lrc, data.result?.syncedLyrics, data.result?.lrc,
    raw && /\[\d{1,2}:\d{2}/.test(raw) ? raw : null);
  const plainCandidate = firstString(data.plainLyrics, data.plain_lyrics, data.lyricsText,
    data.data?.plainLyrics, data.result?.plainLyrics,
    raw && !/\[\d{1,2}:\d{2}/.test(raw) && !/<tt\b/i.test(raw) ? raw : null);
  const plainLyrics = plainCandidate && plainCandidate.length < 300000 ? plainCandidate : null;
  const cleanSynced = syncedLyrics && syncedLyrics.length < 300000 ? syncedLyrics : null;
  const cleanTtml = ttml && ttml.length < 500000 ? ttml : null;
  if (!plainLyrics && !cleanSynced && !cleanTtml) return null;

  const format = cleanTtml ? "ttml" : cleanSynced ? "lrc" : "plain";
  return {
    track: firstString(data.trackName, data.track_name, data.title, data.name, data.song, data.musicName, data.musicNames?.[0]),
    artist: firstString(data.artistName, data.artist_name, data.artist, data.artists?.[0], data.artistNames?.[0]),
    album: firstString(data.albumName, data.album_name, data.album, data.albumNames?.[0]),
    duration: data.duration != null && Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
    instrumental: typeof data.instrumental === "boolean" ? data.instrumental : null,
    plainLyrics: cleanTtml ? (plainLyrics || ttmlToText(cleanTtml)) : plainLyrics,
    syncedLyrics: cleanSynced,
    ttml: cleanTtml,
    format,
    syncLevel: cleanTtml ? (hasWordTiming(cleanTtml) ? "word" : "line") : cleanSynced ? "line" : "none",
    provider,
    ...extra
  };
}
async function request(url, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json, text/plain, */*", "user-agent": USER_AGENT, ...headers }
    });
    const body = await response.text();
    if (body.length > 1_500_000) throw new Error("Provider response too large");
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || /^[\s]*[\[{]/.test(body)) return JSON.parse(body);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
function normalizeMany(data, provider, formatHint = null) {
  if (data?.success === false) return [];
  const source = data?.data ?? data;
  const items = Array.isArray(source) ? source
    : Array.isArray(source?.items) ? source.items
    : Array.isArray(source?.results) ? source.results
    : Array.isArray(source?.result) ? source.result
    : [source];
  return items.map(item => normalizeLyrics(item, provider, formatHint)).filter(Boolean);
}
function isrcLooksValid(value) {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value.toUpperCase());
}
function normalizedKey(value) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function titleArtistScore(result, input) {
  const title = normalizedKey(result.track || "");
  const artist = normalizedKey(result.artist || "");
  const album = normalizedKey(result.album || "");
  const expectedTitle = normalizedKey(input.track || "");
  const expectedArtist = normalizedKey(input.artist || "");
  const expectedAlbum = normalizedKey(input.album || "");
  let score = 0;
  if (expectedTitle && title) score += title === expectedTitle ? 6 : (title.includes(expectedTitle) || expectedTitle.includes(title) ? 2 : -5);
  if (expectedArtist && artist) score += artist === expectedArtist ? 5 : (artist.includes(expectedArtist) || expectedArtist.includes(artist) ? 2 : -5);
  if (expectedAlbum && album) score += album === expectedAlbum ? 2 : (album.includes(expectedAlbum) || expectedAlbum.includes(album) ? 1 : -1);
  if (input.duration != null && result.duration != null) {
    const delta = Math.abs(Number(result.duration) - Number(input.duration));
    score += delta <= 2 ? 3 : delta <= 5 ? 1 : -Math.min(5, delta / 2);
  }
  if (result.syncLevel === "word") score += 3;
  else if (result.syncLevel === "line") score += 1;
  if (result.ttml) score += 1;
  if (result.instrumental === true) score -= 2;
  return score;
}

const providers = [
  {
    id: "lrclib",
    async search(q) {
      const data = await request(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      return normalizeMany(data, "lrclib");
    },
    async exact(input) {
      if (!input.track || !input.artist || input.duration == null) return [];
      const params = new URLSearchParams({
        track_name: input.track, artist_name: input.artist,
        album_name: input.album || "", duration: String(Math.round(input.duration))
      });
      return normalizeMany(await request(`https://lrclib.net/api/get?${params}`), "lrclib");
    }
  },
  {
    id: "betterlyrics",
    async search(input) {
      if (!input.track || !input.artist || input.duration == null) return [];
      const params = new URLSearchParams({
        s: input.track, a: input.artist, al: input.album || input.track,
        d: String(Math.round(input.duration))
      });
      const data = await request(`https://api.betterlyrics.org/getLyrics?${params}`);
      if (!data?.ttml) return [];
      return normalizeMany({ ...data, trackName: input.track, artistName: input.artist, albumName: input.album }, "betterlyrics", "ttml")
        .map(item => ({ ...item, confidence: Number.isFinite(Number(data.score)) ? Number(data.score) : null }));
    }
  },
  {
    id: "unison",
    async search(input) {
      if (input.track && input.artist) {
        const params = new URLSearchParams({ song: input.track, artist: input.artist });
        if (input.album) params.set("album", input.album);
        if (input.duration != null) params.set("duration", String(Math.round(input.duration)));
        const exact = await request(`https://unison.boidu.dev/lyrics?${params}`);
        if (exact?.success && exact.data?.lyrics) {
          return normalizeMany({ ...exact.data, trackName: exact.data.song, artistName: exact.data.artist,
            albumName: exact.data.album, lyrics: exact.data.lyrics }, "unison", exact.data.format)
            .map(item => ({ ...item, confidence: exact.data.confidence || null, matchScore: exact.data.effectiveScore ?? exact.data.score ?? null }));
        }
      }
      const q = input.query || [input.track, input.artist].filter(Boolean).join(" ");
      if (!q) return [];
      const params = new URLSearchParams({ q, limit: "8" });
      const search = await request(`https://unison.boidu.dev/lyrics/search?${params}`);
      if (!search?.success || !Array.isArray(search.data)) return [];
      const candidates = search.data.slice(0, 4);
      const settled = await Promise.allSettled(candidates.map(async candidate => {
        if (!candidate.videoId) return null;
        const lyric = await request(`https://unison.boidu.dev/lyrics?v=${encodeURIComponent(candidate.videoId)}`);
        if (!lyric?.success || !lyric.data?.lyrics) return null;
        return normalizeMany({ ...lyric.data, trackName: lyric.data.song, artistName: lyric.data.artist,
          albumName: lyric.data.album, lyrics: lyric.data.lyrics }, "unison", lyric.data.format)
          .map(item => ({ ...item, confidence: lyric.data.confidence || null, matchScore: candidate.matchScore ?? lyric.data.effectiveScore ?? null }));
      }));
      return settled.flatMap(item => item.status === "fulfilled" && item.value ? item.value : []);
    }
  },
  {
    id: "amll-ttml-db",
    async search(input) {
      const params = new URLSearchParams();
      if (input.track) params.set("musicName", input.track);
      if (input.artist) params.set("artistName", input.artist);
      if (input.album) params.set("albumName", input.album);
      if (!params.size && input.query) params.set("q", input.query);
      if (!params.size && input.isrc) params.set("isrc", input.isrc);
      if (!params.size) return [];
      const search = await request(`https://api.amll.dev/v1/lyrics/search?${params}`);
      const rawItems = search?.data?.items ?? search?.items ?? [];
      if (!Array.isArray(rawItems)) return [];
      const candidates = rawItems.slice(0, 4);
      const settled = await Promise.allSettled(candidates.map(async candidate => {
        if (!candidate.id && !candidate.filename) return null;
        const get = new URLSearchParams(candidate.id ? { id: String(candidate.id) } : { filename: candidate.filename });
        const detail = await request(`https://api.amll.dev/v1/lyrics/get?${get}`);
        if (detail?.status !== 200 || !detail?.data?.lyrics) return null;
        return normalizeMany(detail.data, "amll-ttml-db", "ttml");
      }));
      return settled.flatMap(item => item.status === "fulfilled" && item.value ? item.value : []);
    }
  },
  {
    id: "vgjr-spotify",
    async search(input) {
      return normalizeMany(await request(`https://api.vgjr.top/lyrics/spotify?q=${encodeURIComponent(input.query)}`), "vgjr-spotify");
    }
  },
  {
    id: "vgjr-kugou",
    async search(input) {
      return normalizeMany(await request(`https://api.vgjr.top/lyrics/kugou?q=${encodeURIComponent(input.query)}`), "vgjr-kugou");
    }
  },
  {
    id: "vgjr-shazam",
    async search(input) {
      return normalizeMany(await request(`https://api.vgjr.top/lyrics/shazam?q=${encodeURIComponent(input.query)}`), "vgjr-shazam");
    }
  },
  {
    id: "vgjr-tidal",
    async search(input) {
      return normalizeMany(await request(`https://api.vgjr.top/lyrics/tidal?q=${encodeURIComponent(input.query)}`), "vgjr-tidal");
    }
  },
  {
    id: "vgjr-deezer",
    async search(input) {
      return normalizeMany(await request(`https://api.vgjr.top/lyrics/deezer?q=${encodeURIComponent(input.query)}`), "vgjr-deezer");
    }
  },
  {
    id: "lrc-red",
    async search(input) {
      const isrc = text(input.isrc).toUpperCase();
      if (!isrcLooksValid(isrc)) return [];
      const base = `https://lrc.red/s/${encodeURIComponent(isrc)}`;
      let metadata;
      try { metadata = await request(`${base}.json`); } catch {}
      const result = normalizeMany(metadata, "lrc-red");
      if (result.length) return result;
      const raw = await request(`${base}.lrc`);
      const lyrics = typeof raw === "string" ? raw.trim() : lyricText(raw);
      return lyrics ? normalizeMany(lyrics, "lrc-red") : [];
    }
  }
];

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const lyric = item.ttml || item.syncedLyrics || item.plainLyrics || "";
    const key = lyric.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed", message: "Use GET." }, 405);
  if (["/api/health", "/health"].includes(url.pathname)) {
    return json({ ok: true, name: "Adi Lyrics", version: VERSION, providers: providers.map(p => p.id),
      syncPreference: ["word", "line", "plain"] });
  }
  if (!url.pathname.endsWith("/lyrics") && url.pathname !== "/api" && url.pathname !== "/") {
    return json({ error: "not_found", message: "Try /api/lyrics?track=...&artist=..." }, 404);
  }

  const track = text(url.searchParams.get("track") || url.searchParams.get("title"));
  const artist = text(url.searchParams.get("artist"));
  const album = text(url.searchParams.get("album"));
  const durationParam = url.searchParams.get("duration");
  const duration = durationParam !== null && durationParam !== "" ? Number(durationParam) : null;
  const isrc = text(url.searchParams.get("isrc"));
  const query = text(url.searchParams.get("q")) || [track, artist].filter(Boolean).join(" ");
  const providerFilter = text(url.searchParams.get("provider"));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 10, 20));
  const prefer = text(url.searchParams.get("prefer")) || "word";
  const input = { track, artist, album, duration, isrc, query };
  if (!query && !isrc) return json({ error: "missing_query", message: "Provide q or track. Optional: artist, album, duration, isrc, provider, limit, prefer." }, 400);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 3600)) {
    return json({ error: "invalid_duration", message: "duration must be between 0 and 3600 seconds." }, 400);
  }
  if (!["word", "line", "plain", "best"].includes(prefer)) {
    return json({ error: "invalid_prefer", message: "prefer must be word, line, plain, or best." }, 400);
  }
  const selected = providers.filter(p => !providerFilter || p.id === providerFilter);
  if (providerFilter && selected.length === 0) return json({ error: "unknown_provider", providers: providers.map(p => p.id) }, 400);

  const settled = await Promise.allSettled(selected.map(async provider => {
    let results = await provider.search(input);
    // LRCLIB exact lookup uses duration and metadata; only trust close matches.
    if (provider.id === "lrclib" && track && artist && duration !== null) {
      try {
        const exact = await provider.exact(input);
        if (exact.length) results = [...exact, ...results];
      } catch {}
    }
    return { count: results.length, results };
  }));
  const statuses = settled.map((r, i) => r.status === "fulfilled"
    ? { provider: selected[i].id, ok: true, count: r.value.count }
    : { provider: selected[i].id, ok: false,
        error: r.reason?.name === "AbortError" ? "timeout" : (r.reason?.status === 429 ? "rate_limited" : "unavailable"),
        retryAfter: r.reason?.retryAfter || null });
  let results = dedupe(settled.flatMap(r => r.status === "fulfilled" ? r.value.results : []));
  results = results.map(result => ({ ...result, matchScore: titleArtistScore(result, input) }));
  // If the client gave track/artist metadata, reject explicitly wrong metadata when enough is known.
  const hasExpectedMeta = Boolean(track && artist);
  if (hasExpectedMeta) results = results.filter(result => result.matchScore >= 0);
  const preference = { word: 3, line: 2, plain: 1, best: 0 };
  results.sort((a, b) => {
    const fitA = preference[prefer] === 0 ? 0 : (a.syncLevel === "word" ? (prefer === "word" ? 4 : 2) : a.syncLevel === "line" ? (prefer === "line" ? 4 : 1) : (prefer === "plain" ? 4 : 0));
    const fitB = preference[prefer] === 0 ? 0 : (b.syncLevel === "word" ? (prefer === "word" ? 4 : 2) : b.syncLevel === "line" ? (prefer === "line" ? 4 : 1) : (prefer === "plain" ? 4 : 0));
    return (fitB + b.matchScore) - (fitA + a.matchScore);
  });
  results = results.slice(0, limit);
  const preferred = results[0] || null;
  return json({
    api: "Adi Lyrics", version: VERSION,
    query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null },
    preference: prefer,
    found: results.length > 0,
    count: results.length,
    best: preferred,
    results,
    providers: statuses
  });
}
