import { createClient } from "@libsql/client";

const VERSION = "0.3.1";
const TIMEOUT_MS = 7000;
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
// Remove embedded translation subtrees before extracting or returning TTML.
 // Many TTML sources place Chinese translations inside nested spans such as
 // <span xml:lang="zh-CN">...</span>, sometimes without a ttm:role attribute.
function stripTtmlTranslations(ttml) {
  if (typeof ttml !== "string" || !ttml) return ttml;
  // Only strip Chinese translation spans when the primary lyric text is
  // English. This avoids damaging Chinese-language songs or their originals.
  const withoutChineseSpans = ttml.replace(/<span\b[^>]*xml:lang=["']zh(?:-[^"']*)?["'][^>]*>[\s\S]*?<\/span>/gi, "");
  const rootLanguage = ttml.match(/<tt\b[^>]*xml:lang=["']([^"']+)["']/i)?.[1] || "";
  const letters = withoutChineseSpans.replace(/<[^>]*>/g, "").match(/[A-Za-z\u3400-\u9fff]/g) || [];
  const latinLetters = letters.filter(char => /[A-Za-z]/.test(char)).length;
  const isEnglishPrimary = /^en(?:-|$)/i.test(rootLanguage) ||
    (letters.length > 0 && latinLetters / letters.length >= 0.6);
  if (!isEnglishPrimary) return ttml;
  const tokens = ttml.match(/<[^>]+>|[^<]+/g) || [];
  const stack = [];
  const output = [];
  for (const token of tokens) {
    if (/^<!--|^<!\[CDATA\[|^<!DOCTYPE|^<\?/.test(token)) {
      if (!stack.some(entry => entry.drop)) output.push(token);
      continue;
    }
    const closing = token.match(/^<\/\s*([\w:.-]+)[^>]*>$/);
    if (closing) {
      const index = stack.map(entry => entry.name).lastIndexOf(closing[1]);
      const wasDropped = stack.some(entry => entry.drop);
      if (!wasDropped) output.push(token);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const opening = token.match(/^<\s*([\w:.-]+)([\s\S]*?)>$/);
    if (!opening) {
      if (!stack.some(entry => entry.drop)) output.push(token);
      continue;
    }
    const name = opening[1];
    const attrs = opening[2];
    const selfClosing = /\/\s*$/.test(attrs);
    const parentDropped = stack.some(entry => entry.drop);
    const role = attrs.match(/(?:[\w.-]+:)?role\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const lang = attrs.match(/xml:lang\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const isChineseTranslation = /^zh(?:-|$)/i.test(lang) &&
      (name.toLowerCase().endsWith(":span") || name.toLowerCase() === "span");
    const isTranslation = isChineseTranslation ||
      (/translation/i.test(role) && /^zh(?:-|$)/i.test(lang));
    const drop = parentDropped || isTranslation;
    if (!drop) output.push(token);
    if (!selfClosing) stack.push({ name, drop });
  }
  return output.join("");
}

function ttmlToText(ttml) {
  ttml = stripTtmlTranslations(ttml);
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
function syncArrayToLrc(lines) {
  if (!Array.isArray(lines)) return null;
  const output = [];
  for (const line of lines) {
    const milliseconds = Number(line?.startTimeMs ?? line?.start_time_ms);
    const words = typeof line?.words === "string" ? line.words :
      Array.isArray(line?.words) ? line.words.map(word => typeof word === "string" ? word : word?.text || "").join("") : "";
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || !words.trim()) continue;
    const totalCentiseconds = Math.floor(milliseconds / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    output.push(`[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}]${words.trim()}`);
  }
  return output.length ? output.join("\n") : null;
}

function normalizeLyrics(data, provider, formatHint = null) {
  if (typeof data === "string") {
    const raw = data.trim();
    if (!raw) return null;
    if (/<tt\b/i.test(raw)) {
      const cleanTtml = stripTtmlTranslations(raw);
      return {
        track: null, artist: null, album: null, duration: null, instrumental: null,
        plainLyrics: ttmlToText(cleanTtml), syncedLyrics: null, ttml: cleanTtml, format: "ttml",
        syncLevel: inferSyncLevel(cleanTtml), provider
      };
    }
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
    raw && /\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(raw) ? raw : null,
    syncArrayToLrc(syncLyrics));
  const plain = firstString(data.plainLyrics, data.plain_lyrics, data.lyricsText, nested?.plainLyrics,
    raw && !/<tt\b/i.test(raw) && !/\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(raw) ? raw : null);
  const cleanTtml = ttml && ttml.length < 500000 ? stripTtmlTranslations(ttml) : null;
  const cleanSynced = synced && synced.length < 300000 ? synced : null;
  const cleanPlain = plain && plain.length < 300000 ? plain : null;
  if (!cleanTtml && !cleanSynced && !cleanPlain) return null;
  const format = cleanTtml ? "ttml" : cleanSynced ? "lrc" :
    (syncLyrics?.length ? "sync-json" : (formatHint || "plain"));
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
  // Some providers (notably VGJR) put track metadata in data.data while
  // the actual lyrics and syncLyrics live on the outer object. Never unwrap
  // that envelope when the outer object already contains lyric content.
  const hasRootLyrics = typeof data?.lyrics === "string" ||
    typeof data?.ttml === "string" || typeof data?.syncedLyrics === "string" ||
    Array.isArray(data?.syncLyrics) || typeof data?.plainLyrics === "string";
  const source = Array.isArray(data) ? data
    : Array.isArray(data?.data) ? data.data
    : data?.data && typeof data.data === "object" && !hasRootLyrics ? data.data
    : data;
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
    const song = input.track || input.query;
    if (!song) return [];
    // Better Lyrics requires a song parameter. Metadata improves matching,
    // but query-only searches should still be attempted instead of skipped.
    const params = new URLSearchParams({
      s: song,
      a: input.artist || "",
      al: input.album || input.track || song,
      d: String(Math.round(input.duration ?? 0))
    });
    // The default route returns { ttml }, while the provider-specific route
    // returns { lyrics, provider }. Accept both documented response shapes.
    let data = null;
    try { data = await request(`https://api.betterlyrics.org/getLyrics?${params}`); } catch {}
    if (!data?.ttml && !(typeof data?.lyrics === "string" && /<tt\b/i.test(data.lyrics))) {
      try { data = await request(`https://api.betterlyrics.org/ttml/getLyrics?${params}`); } catch {}
    }
    const ttml = firstString(data?.ttml,
      typeof data?.lyrics === "string" && /<tt\b/i.test(data.lyrics) ? data.lyrics : null);
    if (!ttml) return [];
    return normalizeMany({ ...data, ttml, trackName: input.track || data.trackName || data.title || song,
      artistName: input.artist || data.artistName || data.artist,
      albumName: input.album || data.albumName || data.album }, "betterlyrics").map(item => ({
        ...item, confidence: typeof data.score === "number" ? data.score : null
      }));
  }},
  { id: "unison", async search(input) {
    let exact;
    if (input.track && input.artist) {
      const params = new URLSearchParams({ song: input.track, artist: input.artist });
      if (input.album) params.set("album", input.album);
      if (input.duration != null) params.set("duration", String(Math.round(input.duration)));
      exact = await request(`https://unison.boidu.dev/lyrics?${params}`);
    } else if (input.query) {
      // /lyrics/search is discovery-only: fetch the selected candidate by
      // videoId before attempting to normalize its lyrics.
      const search = await request(`https://unison.boidu.dev/lyrics/search?q=${encodeURIComponent(input.query)}&limit=5`);
      const candidates = Array.isArray(search?.data) ? search.data : [];
      const candidate = candidates.find(item => item?.videoId) || candidates[0];
      if (!candidate?.videoId) return [];
      exact = await request(`https://unison.boidu.dev/lyrics?v=${encodeURIComponent(candidate.videoId)}`);
      if (exact?.success && exact.data) {
        exact.data.matchScore = candidate.matchScore ?? null;
      }
    } else return [];
    if (exact?.success && exact.data?.lyrics) {
      return normalizeMany({ ...exact.data, trackName: exact.data.song, artistName: exact.data.artist,
        albumName: exact.data.album, lyrics: exact.data.lyrics }, "unison", exact.data.format)
        .map(item => ({ ...item, confidence: exact.data.confidence || null,
          matchScore: exact.data.matchScore ?? exact.data.effectiveScore ?? exact.data.score ?? null }));
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
  { id: "lrc-red", priority: 100, async search(input) {
    const isrc = text(input.isrc).toUpperCase();
    const validIsrc = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc);
    const query = [input.track, input.artist].filter(Boolean).join(" ") || input.query;
    const candidates = [];
    // Search first so this provider works for ordinary title/artist queries,
    // not only callers that already know the recording's ISRC.
    if (query) {
      try {
        const params = new URLSearchParams({ q: query });
        const searchData = await request(`https://lrc.red/api/v1?${params}`);
        const list = Array.isArray(searchData) ? searchData :
          Array.isArray(searchData?.results) ? searchData.results :
          Array.isArray(searchData?.data?.results) ? searchData.data.results :
          Array.isArray(searchData?.data) ? searchData.data : [];
        candidates.push(...list);
      } catch {}
    }
    const norm = value => normalizedKey(value || "");
    const wantedTitle = norm(input.track);
    const wantedArtist = norm(input.artist);
    const candidateScore = item => {
      const title = norm(item?.title || item?.track || item?.trackName || item?.track_name);
      const artist = norm(item?.artist || item?.artists || item?.artistName || item?.artist_name);
      let score = 0;
      if (wantedTitle && title) score += title === wantedTitle ? 8 :
        (title.includes(wantedTitle) || wantedTitle.includes(title) ? 3 : -20);
      if (wantedArtist && artist) score += artist === wantedArtist ? 7 :
        (artist.includes(wantedArtist) || wantedArtist.includes(artist) ? 3 : -20);
      if (input.duration != null && item?.duration != null) {
        const delta = Math.abs(Number(item.duration) - Number(input.duration));
        score += delta <= 2 ? 3 : delta <= 5 ? 1 : -Math.min(6, delta);
      }
      return score;
    };
    candidates.sort((a, b) => candidateScore(b) - candidateScore(a));
    for (const candidate of candidates) {
      const lyricsUrl = firstString(candidate?.lyricsUrl, candidate?.lyrics_url, candidate?.ttmlUrl,
        candidate?.ttml_url, candidate?.url);
      if (!lyricsUrl) {
        const inline = normalizeLyrics(candidate, "lrc-red");
        if (inline) return [{ ...inline, confidence: candidateScore(candidate) }];
        continue;
      }
      let target;
      try { target = new URL(lyricsUrl, "https://lrc.red"); } catch { continue; }
      if (target.protocol !== "https:" || !(target.hostname === "lrc.red" || target.hostname.endsWith(".lrc.red"))) continue;
      try {
        const body = await request(target.toString());
        const normalized = normalizeMany(body, "lrc-red", target.pathname.endsWith(".lrc") ? "lrc" : null);
        if (normalized.length) return normalized.map(item => ({
          ...item,
          track: item.track || firstString(candidate.title, candidate.track, input.track),
          artist: item.artist || firstString(candidate.artist, candidate.artistName, input.artist),
          album: item.album || firstString(candidate.album, input.album),
          duration: item.duration ?? candidate.duration ?? input.duration ?? null,
          confidence: candidateScore(candidate)
        }));
        if (typeof body === "string" && /<tt\b/i.test(body)) {
          const item = normalizeLyrics(body, "lrc-red");
          if (item) return [{ ...item, track: firstString(candidate.title, input.track),
            artist: firstString(candidate.artist, input.artist), confidence: candidateScore(candidate) }];
        }
      } catch {}
    }
    // ISRC direct resources are useful when a caller already has an exact ID.
    if (validIsrc) {
      for (const extension of ["ttml", "lrc", "json"]) {
        try {
          const body = await request(`https://lrc.red/s/${encodeURIComponent(isrc)}.${extension}`);
          const found = normalizeMany(body, "lrc-red", extension === "lrc" ? "lrc" : null);
          if (found.length) return found.map(item => ({ ...item, track: item.track || input.track || null,
            artist: item.artist || input.artist || null, confidence: 100 }));
          if (typeof body === "string" && /<tt\b/i.test(body)) {
            const item = normalizeLyrics(body, "lrc-red");
            if (item) return [{ ...item, track: input.track || null, artist: input.artist || null, confidence: 100 }];
          }
        } catch {}
      }
    }
    return [];
  }},
  { id: "lrcmux", priority: 90, async search(input) {
    let artist = text(input.artist);
    let title = text(input.track);
    // Accept "Title - Artist" as a convenience when callers only provide q.
    if (!artist && !title && input.query) {
      const parts = input.query.split(/\s+-\s+/);
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        title = parts[0].trim();
        artist = parts[1].trim();
      }
    }
    if (!artist || !title) return [];

    const params = new URLSearchParams({ artist, title });
    if (input.album) params.set("album", input.album);
    if (input.duration != null) params.set("duration", String(Math.round(input.duration)));
    const data = await request(`https://api.lrcmux.dev/compat/kpoe/v2/lyrics/get?${params}`);
    if (!data || typeof data !== "object") return [];

    // The KPoe compatibility route can wrap its payload. Accept the common
    // envelope shapes while keeping one normalized Adi Lyrics response.
    const payload = data.data && typeof data.data === "object" ? data.data :
      data.result && typeof data.result === "object" ? data.result : data;
    const rawLines = Array.isArray(payload.lines) ? payload.lines :
      Array.isArray(payload.lyrics) ? payload.lyrics :
      Array.isArray(payload.content) ? payload.content :
      Array.isArray(data.lines) ? data.lines :
      Array.isArray(data.lyrics) ? data.lyrics : [];
    if (!rawLines.length) {
      // Some compatibility responses already use the standard lyrics schema.
      return normalizeMany(data, "lrcmux").map(item => ({ ...item, provider: "lrcmux" }));
    }

    const lines = rawLines.map(line => {
      if (typeof line === "string") return { text: line };
      if (!line || typeof line !== "object") return null;
      const textValue = firstString(line.text, line.lyric, line.content,
        Array.isArray(line.words) ? line.words.map(word =>
          typeof word === "string" ? word : firstString(word?.text, word?.word, word?.syllable) || ""
        ).join("") : null);
      if (!textValue) return null;
      const rawStart = line.startTimeMs ?? line.start_time_ms ?? line.startTime ??
        line.start_time ?? line.start ?? line.time ?? line.timestamp;
      const rawEnd = line.endTimeMs ?? line.end_time_ms ?? line.endTime ??
        line.end_time ?? line.end;
      const start = rawStart == null ? null : Number(rawStart);
      const end = rawEnd == null ? null : Number(rawEnd);
      // Explicit *Ms fields and KPoe-style numeric startTime values are in ms.
      return { ...line, text: textValue, start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) ? end : null };
    }).filter(Boolean);
    if (!lines.length) return [];

    const plainLyrics = lines.map(line => line.text.trim()).filter(Boolean).join("\n");
    const syncLyrics = lines.filter(line => line.start != null && line.start >= 0).map(line => ({
      startTimeMs: line.start,
      words: line.text,
      syllables: Array.isArray(line.words) ? line.words : []
    }));
    const syncedLyrics = syncArrayToLrc(syncLyrics);
    const metadata = payload.meta || data.meta || {};
    const track = payload.track && typeof payload.track === "object" ? payload.track : {};
    const wordSync = lines.some(line => Array.isArray(line.words) && line.words.length > 0) ||
      /word|syllable/i.test(String(metadata.level || payload.level || data.level || ""));
    return [{
      track: firstString(track.title, payload.title, payload.trackName, payload.track_name, title),
      artist: firstString(track.artist, payload.artist, payload.artistName, payload.artist_name, artist),
      album: firstString(track.album, payload.album, payload.albumName, input.album),
      duration: (() => {
        const value = track.duration ?? payload.duration ?? input.duration;
        const n = Number(value);
        return value != null && Number.isFinite(n) ? (n > 3600 ? n / 1000 : n) : null;
      })(),
      instrumental: metadata.instrumental === true || payload.instrumental === true,
      plainLyrics,
      syncedLyrics,
      ttml: firstString(payload.ttml, payload.lyricsTtml),
      format: "lrcmux-compat",
      syncLevel: wordSync ? "word" : syncedLyrics ? "line" : "none",
      hasWordSync: wordSync,
      syncLyrics,
      provider: "lrcmux",
      upstream: firstString(metadata.source, payload.source, data.source),
      confidence: null
    }];
  }}
];

function dedupe(items) {
  const seen = new Set();
  // Sort before deduplication so a primary provider's copy wins when
  // another provider returns the same lyric text.
  const ranked = [...items].sort((a, b) => {
    const priority = item => providers.find(provider => provider.id === item.provider)?.priority || 0;
    return priority(b) - priority(a);
  });
  return ranked.filter(item => {
    const body = item.ttml || item.syncedLyrics || item.plainLyrics || "";
    const key = body.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}


const TURSO_URL = "libsql://lyrics-adidotzip.aws-ap-south-1.turso.io";
let tursoClient;
let tursoSchemaPromise;

function getTursoClient() {
  if (!process.env.T) return null;
  if (!tursoClient) {
    tursoClient = createClient({ url: TURSO_URL, authToken: process.env.T });
  }
  return tursoClient;
}

async function ensureSyllableCacheTable(client) {
  if (!tursoSchemaPromise) {
    tursoSchemaPromise = client.execute(`
      CREATE TABLE IF NOT EXISTS syllable_lyrics_cache (
        cache_key TEXT PRIMARY KEY,
        track TEXT,
        artist TEXT,
        album TEXT,
        duration REAL,
        provider TEXT NOT NULL,
        lyrics_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).catch(error => {
      tursoSchemaPromise = null;
      throw error;
    });
  }
  await tursoSchemaPromise;
}

function syllableCacheKey(input) {
  if (input.isrc) return `isrc:${text(input.isrc).toUpperCase()}`;
  if (input.track && input.artist) {
    return `track:${normalizedKey(input.track)}|artist:${normalizedKey(input.artist)}|album:${normalizedKey(input.album || "")}`;
  }
  return input.query ? `query:${normalizedKey(input.query)}` : null;
}

function hasSyllableSync(result) {
  if (!result || typeof result !== "object") return false;
  // BetterLyrics provides syllable-timed TTML; require actual timed spans.
  if (result.provider === "betterlyrics" && typeof result.ttml === "string" &&
      /<span\\b[^>]*(?:begin|end)=/i.test(result.ttml)) return true;

  // Structured providers must explicitly supply syllables with timing.
  const syllableRows = Array.isArray(result.syncLyrics) ? result.syncLyrics : [];
  return syllableRows.some(line => Array.isArray(line?.syllables) &&
    line.syllables.some(syllable => syllable && typeof syllable === "object" &&
      (syllable.startTimeMs != null || syllable.start != null || syllable.startTime != null) &&
      firstString(syllable.text, syllable.word, syllable.syllable) !== null));
}

async function readSyllableCache(input, requestedProvider) {
  const client = getTursoClient();
  const key = syllableCacheKey(input);
  if (!client || !key) return null;
  try {
    await ensureSyllableCacheTable(client);
    const result = await client.execute({
      sql: "SELECT lyrics_json, provider FROM syllable_lyrics_cache WHERE cache_key = ? LIMIT 1",
      args: [key]
    });
    const row = result.rows?.[0];
    if (!row || (requestedProvider && String(row.provider) !== requestedProvider)) return null;
    const lyrics = JSON.parse(String(row.lyrics_json));
    if (!hasSyllableSync(lyrics)) return null;
    return lyrics;
  } catch (error) {
    console.warn("Turso syllable cache read failed:", error?.message || "unknown error");
    return null;
  }
}

async function writeSyllableCache(input, result) {
  if (!hasSyllableSync(result)) return false;
  const client = getTursoClient();
  const key = syllableCacheKey(input);
  if (!client || !key) return false;
  try {
    await ensureSyllableCacheTable(client);
    await client.execute({
      sql: `INSERT INTO syllable_lyrics_cache
        (cache_key, track, artist, album, duration, provider, lyrics_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(cache_key) DO UPDATE SET
          track = excluded.track,
          artist = excluded.artist,
          album = excluded.album,
          duration = excluded.duration,
          provider = excluded.provider,
          lyrics_json = excluded.lyrics_json,
          created_at = datetime('now')`,
      args: [
        key,
        result.track || input.track || null,
        result.artist || input.artist || null,
        result.album || input.album || null,
        result.duration ?? input.duration ?? null,
        result.provider,
        JSON.stringify(result)
      ]
    });
    return true;
  } catch (error) {
    console.warn("Turso syllable cache write failed:", error?.message || "unknown error");
    return false;
  }
}

async function handle(req) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed", message: "Use GET." }, 405);
  if (["/api/health", "/health"].includes(url.pathname)) return json({
    ok: true, name: "Adi Lyrics", version: VERSION, providers: providers.map(p => p.id),
    syncPreference: ["word", "line", "plain"]
  });
  if (!["/api/lyrics", "/lyrics", "/api/search", "/search", "/api", "/"].includes(url.pathname))
    return json({ error: "not_found", message: "Try /api/lyrics?track=...&artist=... or /api/search?q=..." }, 404);

  const track = text(url.searchParams.get("track") || url.searchParams.get("title"));
  const artist = text(url.searchParams.get("artist"));
  const album = text(url.searchParams.get("album"));
  const durationValue = url.searchParams.get("duration");
  const duration = durationValue !== null && durationValue !== "" ? Number(durationValue) : null;
  const isrc = text(url.searchParams.get("isrc"));
  const query = text(url.searchParams.get("q")) || [track, artist].filter(Boolean).join(" ");
  const provider = text(url.searchParams.get("provider"));
  const prefer = text(url.searchParams.get("prefer")) || "word";
  if (!query && !isrc) return json({ error: "missing_query", message: "Provide q or track. Optional: artist, album, duration, isrc, provider, prefer." }, 400);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 3600))
    return json({ error: "invalid_duration", message: "duration must be between 0 and 3600 seconds." }, 400);
  if (!["word", "line", "plain", "best"].includes(prefer))
    return json({ error: "invalid_prefer", message: "prefer must be word, line, plain, or best." }, 400);
  const selected = providers.filter(p => !provider || p.id === provider).filter(p => provider || !p.fallbackOnly);
  if (provider && !selected.length) return json({ error: "unknown_provider", providers: providers.map(p => p.id) }, 400);
  const input = { track, artist, album, duration, isrc, query };

  // Return cached content only when it was previously verified as syllable-synced.
  const cached = await readSyllableCache(input, provider || null);
  if (cached) {
    return json({
      api: "Adi Lyrics",
      version: VERSION,
      query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null },
      preference: prefer,
      found: true,
      count: 1,
      lyrics: { ...cached, cached: true },
      best: { ...cached, cached: true },
      providers: [{ provider: "turso-cache", ok: true, count: 1, cached: true }]
    });
  }
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
  const providerPriority = result => {
    const provider = providers.find(item => item.id === result.provider);
    return provider?.priority || 0;
  };
  results.sort((a, b) => {
    // lrc.red and lrcmux are primary sources; identity mismatches are filtered above.
    const priorityA = providerPriority(a);
    const priorityB = providerPriority(b);
    if (priorityA !== priorityB) return priorityB - priorityA;
    // Correct track identity and source confidence outweigh the sync format.
    const confidenceA = typeof a.confidence === "number" ? a.confidence * 2 : 0;
    const confidenceB = typeof b.confidence === "number" ? b.confidence * 2 : 0;
    return (b.matchScore + preferenceBonus(b) + confidenceB) -
      (a.matchScore + preferenceBonus(a) + confidenceA);
  });
  // Return one canonical result regardless of which upstream provider won.
  // Keep "best" as a compatibility alias, but never return a provider-specific
  // results array that forces clients to implement their own normalization.
  const best = results[0] || null;
  if (best && hasSyllableSync(best)) {
    await writeSyllableCache(input, best);
  }
  return json({
    api: "Adi Lyrics",
    version: VERSION,
    query: { track: track || null, artist: artist || null, album: album || null, duration, q: query || null, isrc: isrc || null },
    preference: prefer,
    found: Boolean(best),
    count: best ? 1 : 0,
    lyrics: best,
    best,
    providers: statuses
  });
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
