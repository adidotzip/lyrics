# Adi Lyrics

Adi Lyrics is my lyrics API. It searches different lyrics providers and returns one result in a consistent format, so apps using it don't have to handle every provider separately.

API: https://lyrics.imreallyadi.space

## Lyrics providers

The API checks multiple sources, including:

- [lrc.red](https://lrc.red/)
- [lrcMUX](https://lrcmux.dev/)
- [LRCLIB](https://lrclib.net/)
- [Better Lyrics](https://lyrics-api-docs.boidu.dev/reference/get-lyrics)
- [Unison](https://lyrics-api-docs.boidu.dev/unison)
- [AMLL TTML Database](https://github.com/amll-dev/amll-ttml-db)
- VGJR lyrics sources for Spotify, KuGou, Shazam, Tidal and Deezer
- [Popcat](https://api.popcat.xyz/v2/lyrics) as a fallback

lrc.red and lrcMUX are treated as primary sources. The API still checks other providers when needed. Providers can fail or change their responses, so one source not working should not stop the whole request.

## Endpoints

### Get lyrics

`GET /api/lyrics`

Returns the best lyrics result the API can find.

Example:

```sh
curl "https://lyrics.imreallyadi.space/api/lyrics?track=E85&artist=Don%20Toliver&album=OCTANE&duration=154"
```

You can use these query parameters:

- `track`: song title
- `q`: search text
- `artist`: artist name
- `album`: album name
- `duration`: track duration in seconds
- `isrc`: recording ID
- `prefer`: `word`, `line`, `plain` or `best`
- `provider`: use one provider instead of checking all of them

The default is `prefer=word`, which prioritizes word or syllable timing while still considering how well the result matches the song.

### Search lyrics

`GET /api/search`

This uses the same lyrics resolver as `/api/lyrics`. You can search with a title or a free-text query.

```sh
curl "https://lyrics.imreallyadi.space/api/search?q=E85%20Don%20Toliver&prefer=word"
```

Provider IDs include `lrclib`, `betterlyrics`, `unison`, `amll-ttml-db`, `lrc-red`, `lrcmux`, `vgjr-spotify`, `vgjr-kugou`, `vgjr-shazam`, `vgjr-tidal`, `vgjr-deezer` and `popcat`.

### Get song metadata

`GET /api/metadata`

Uses Apple's public iTunes API to find song information. It can return the song, artist and album IDs, artwork, Apple Music links, preview URL, duration, release date, genre, track/disc number, explicit status, pricing and other metadata. It can also return alternate editions when Apple has close matches.

```sh
curl "https://lyrics.imreallyadi.space/api/metadata?track=Blinding%20Lights&artist=The%20Weeknd"
```

Parameters:

- `track`: song title
- `artist`: artist name
- `album`: album name
- `duration`: duration in seconds
- `q`: free-text search
- `country`: two-letter iTunes storefront code, defaults to `US`

Lyrics responses can include this metadata too. Metadata lookup is separate from lyrics lookup, so an iTunes error should not stop the lyrics search.

### Search the music catalog

`GET /api/music/search`

Searches Apple's catalog for songs, albums, artists or music videos.

```sh
curl "https://lyrics.imreallyadi.space/api/music/search?q=Daft%20Punk&type=artist"
```

Parameters:

- `q` or `term`: search query
- `type`: `all`, `song`, `album`, `artist` or `musicVideo`
- `country`: two-letter storefront code
- `limit`: number of results

### Look up a catalog ID

`GET /api/music/lookup`

Looks up an Apple/iTunes catalog ID.

```sh
curl "https://lyrics.imreallyadi.space/api/music/lookup?id=909253&entity=album"
```

Parameters: `id`, optional `entity`, `country` and `limit`. Entity can be `song`, `album`, `artist` or `musicVideo`.

### Get an artist and their albums

`GET /api/music/artist?id=...`

```sh
curl "https://lyrics.imreallyadi.space/api/music/artist?id=5468295"
```

Use the Apple artist ID as `id`.

### Get an album and its tracks

`GET /api/music/album?id=...`

```sh
curl "https://lyrics.imreallyadi.space/api/music/album?id=1440857781"
```

Use the Apple album ID as `id`.

### Get a song by ID

`GET /api/music/song?id=...`

```sh
curl "https://lyrics.imreallyadi.space/api/music/song?id=1440857782"
```

Use the Apple song ID as `id`.

### Get music charts

`GET /api/music/top`

Gets chart listings from Apple Music RSS.

```sh
curl "https://lyrics.imreallyadi.space/api/music/top?type=albums&country=US&limit=25"
```

Parameters:

- `type`: `songs`, `albums` or `music-videos`
- `country`: two-letter storefront code
- `limit`: number of results, up to 100

These music catalog endpoints use Apple's public APIs and do not need an Apple Music developer token.

### Check API status

`GET /api/health`

Returns API version and supported providers.

## Response format

The lyrics endpoints return a `found` flag, a `lyrics` object (or `null` if nothing matched), and provider status information. The `best` field is also included as an alias for `lyrics`.

A lyrics result can include fields like:

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

Some fields might be `null` or missing if the provider doesn't return them. `syncLevel` describes the timing format. It doesn't guarantee the lyrics are correct.

## How matching works

The API uses the song title and any available artist, album, duration and ISRC information to help pick a result. Word-synced lyrics are preferred by default, but a better timing format doesn't automatically mean the lyrics are more accurate.

LRCLIB can also return a `lyricsfile` with word timing. The API preserves that field, but it doesn't currently convert it into the normalized TTML format, so you'll need a compatible parser if you want to use it.

## Run locally

You need Node.js 20 or newer.

```sh
npm install
npm start
```

To deploy it, connect the repository to Vercel.

## Notes

Lyrics belong to their respective rights holders. This project doesn't claim ownership of lyrics returned by the providers. Please follow each provider's terms, attribution requirements and rate limits.

## License

The API code is licensed under MIT. This does not change the licensing or usage terms for lyrics returned by other services.
