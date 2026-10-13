# Adi Lyrics

A free, open-source lyrics aggregator API at `https://lyrics.imreallyadi.music` that searches multiple lyric sources and returns normalized results with source and synchronization metadata.

## Providers

- [LRCLIB](https://lrclib.net/) for plain and line-synchronized lyrics.
- [AMLL TTML Database](https://github.com/amll-dev/amll-ttml-db), accessed through the official [AMLL TTML API](https://amll.dev/reference/http-api/overview), for TTML and word-level timing.
- [Better Lyrics API](https://lyrics-api-docs.boidu.dev/reference/get-lyrics) for TTML with syllable-level timing.
- [Unison](https://lyrics-api-docs.boidu.dev/unison) for community-synced TTML/LRC/plain lyrics.
- **Primary:** [lrc.red](https://lrc.red/), searched by title/artist and fetched as TTML/LRC when available, with ISRC resource fallback.
- **Primary:** [lrcmux](https://lrcmux.dev/) for structured line/word timing. These two sources are ranked ahead of the other providers when they return usable lyrics.
- VGJR endpoints for Spotify, KuGou, Shazam, Tidal and Deezer lyrics, including nested track metadata and `syncLyrics` payloads.
- [Popcat lyrics](https://api.popcat.xyz/v2/lyrics) as a last-resort fallback only when the other sources return no usable lyrics.

Upstream schemas, availability and rate limits can change. Adapter failures are isolated and reported per provider.

## Endpoints

### `GET /api/lyrics` and `GET /api/search`

Both paths use the same unified resolver and return **one best lyrics result**, regardless of the provider that supplied it. Send a title (`track`) or free-text `q`. Supplying `artist`, `album`, `duration` (seconds), and `isrc` improves matching and enables providers that require exact metadata.

```sh
curl "https://lyrics.imreallyadi.music/api/lyrics?track=E85&artist=Don%20Toliver&album=OCTANE&duration=154"
# Equivalent alias:
curl "https://lyrics.imreallyadi.music/api/search?q=E85%20Don%20Toliver&prefer=word"
```

The default `prefer=word` prioritizes word/syllable timing after track identity and confidence are considered. Other values are `line`, `plain`, and `best`. You can restrict lookup to one provider with `provider=betterlyrics`, but normal use should omit `provider` so the resolver can compare all sources.

Supported provider IDs: `lrclib`, `betterlyrics`, `unison`, `amll-ttml-db`, `lrc-red`, `lrcmux`, `vgjr-spotify`, `vgjr-kugou`, `vgjr-shazam`, `vgjr-tidal`, `vgjr-deezer`, `popcat`.

### `GET /api/health`

Returns the API version and supported providers.

## Response format

Every lyrics endpoint returns the same schema with a single canonical `lyrics` object (or `null` when nothing matched), a `found` flag, and per-provider status summaries. `best` remains as a backwards-compatible alias for `lyrics`. The API does not return a provider-specific `results` array, so clients do not need to merge, rank, or normalize providers themselves.

A normalized result can look like:

```json
{
  "track": "E85",
  "artist": "Don Toliver",
  "album": "OCTANE",
  "duration": 154,
  "plainLyrics": "...",
  "syncedLyrics": null,
  "ttml": "<?xml version=...",
  "format": "ttml",
  "syncLevel": "word",
  "provider": "betterlyrics",
  "confidence": 0.97,
  "matchScore": 20.5
}
```

Fields that a provider does not supply are omitted or set to `null`. `syncLevel` describes the timing structure, not lyric accuracy.

## Matching and accuracy

- Title, artist, album and duration metadata affect ranking; explicit metadata mismatches are filtered when title and artist are provided.
- Word/syllable timing is a preference, not proof that the lyrics are correct.
- LRCLIB's `hasWordSync` indicates word-level timings are available in `lyricsfile`; Adi Lyrics now preserves both fields and reports the record as word-timed when both are present. Its basic `syncedLyrics` field is line-level LRC. Adi Lyrics does not yet convert LRCLIB's raw `lyricsfile` into normalized TTML, so the client should use a compatible Lyricsfile parser if selecting that field.
- The API compares provider metadata and any exposed confidence value, but cannot algorithmically guarantee every sung word is correct. If sources disagree, inspect the result and keep the source attribution.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Deploy by importing the repository into Vercel.

## Responsible use

Lyrics are copyrighted works owned by their respective rights holders. This project does not claim ownership of fetched lyrics. The AMLL database notes that content is governed by its applicable sharing terms, including attribution or upstream-specific conditions. Review each upstream source's terms, rate limits and attribution requirements before operating a public deployment. Respect upstream rate limits and access controls.

## License

The aggregator code is MIT licensed. This does not relicense lyrics returned by upstream providers; their individual terms continue to apply.
