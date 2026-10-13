# Adi Lyrics

A free, open-source lyrics aggregator API that searches multiple lyric sources and returns normalized results with source and synchronization metadata.

## Providers

- [LRCLIB](https://lrclib.net/) for plain and line-synchronized lyrics.
- [AMLL TTML Database](https://github.com/amll-dev/amll-ttml-db), accessed through the official [AMLL TTML API](https://amll.dev/reference/http-api/overview), for TTML and word-level timing.
- [Better Lyrics API](https://lyrics-api-docs.boidu.dev/reference/get-lyrics) for TTML with syllable-level timing.
- [Unison](https://lyrics-api-docs.boidu.dev/unison) for community-synced TTML/LRC/plain lyrics.
- [lrc.red](https://lrc.red/) via ISRC-keyed resources.
- VGJR endpoints for Spotify, KuGou, Shazam, Tidal and Deezer lyrics.

Upstream schemas, availability and rate limits can change. Adapter failures are isolated and reported per provider.

## Endpoints

### `GET /api/lyrics`

Search across providers. Send a title (`track`) or `q`. Supplying `artist`, `album`, `duration` (seconds), and `isrc` improves matching and enables providers that require exact metadata.

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?track=E85&artist=Don%20Toliver&album=OCTANE&duration=154"
```

Prefer word/syllable timing (default):

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?track=E85&artist=Don%20Toliver&album=OCTANE&duration=154&prefer=word"
```

Choose a single source:

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?track=E85&artist=Don%20Toliver&album=OCTANE&duration=154&provider=betterlyrics"
```

Supported provider IDs: `lrclib`, `betterlyrics`, `unison`, `amll-ttml-db`, `lrc-red`, `vgjr-spotify`, `vgjr-kugou`, `vgjr-shazam`, `vgjr-tidal`, `vgjr-deezer`.

Optional `prefer` values:
- `word` (default): prefer word/syllable-level timing.
- `line`: prefer line-synchronized lyrics.
- `plain`: prefer unsynchronized plain text.
- `best`: rank primarily by metadata match and confidence.

### `GET /api/health`

Returns the API version and supported providers.

## Response format

The response includes the selected `best` record, ranked `results`, and provider status summaries. Results preserve the original `ttml` where available and also include `plainLyrics` for clients that need a text fallback.

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
