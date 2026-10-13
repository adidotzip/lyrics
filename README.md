# Adi Lyrics

A free, open-source lyrics aggregator API. It queries multiple lyric providers and normalizes available lyrics into a consistent JSON response.

## Providers

- **LRCLIB**: free-text search and exact-track lookup.
- **lrc.red**: ISRC-keyed JSON and LRC resources. Supply `isrc` to use this provider.
- **VGJR Spotify**: `https://api.vgjr.top/lyrics/spotify?q=...`
- **VGJR KuGou**: `https://api.vgjr.top/lyrics/kugou?q=...`
- **VGJR Shazam**: `https://api.vgjr.top/lyrics/shazam?q=...`
- **VGJR Tidal**: `https://api.vgjr.top/lyrics/tidal?q=...`
- **VGJR Deezer**: `https://api.vgjr.top/lyrics/deezer?q=...`

Provider response schemas can change. Adapters are isolated so they can be updated without changing the public API.

## Endpoints

### `GET /api/lyrics`

Search all providers concurrently. At least `q` or `track` is required.

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?q=Never%20Gonna%20Give%20You%20Up%20Rick%20Astley"
```

Exact LRCLIB lookup (duration is in seconds):

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?track=I%20Want%20to%20Live&artist=Borislav%20Slavov&album=Baldur%27s%20Gate%203&duration=233"
```

Choose one provider:

```sh
curl "https://YOUR-DEPLOYMENT/api/lyrics?q=Never%20Gonna%20Give%20You%20Up&provider=lrclib"
```

Supported provider IDs: `lrclib`, `lrc-red`, `vgjr-spotify`, `vgjr-kugou`, `vgjr-shazam`, `vgjr-tidal`, `vgjr-deezer`.

Optional parameters: `artist`, `album`, `duration`, `isrc`, `provider`, `limit` (1–20).

### `GET /api/health`

Returns API version and configured provider IDs.

## Response shape

```json
{
  "api": "Adi Lyrics",
  "version": "0.1.0",
  "found": true,
  "count": 1,
  "results": [
    {
      "track": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "album": null,
      "duration": null,
      "instrumental": null,
      "plainLyrics": null,
      "syncedLyrics": "[00:19.67]...",
      "provider": "lrclib"
    }
  ],
  "providers": [
    { "provider": "lrclib", "ok": true, "count": 1 },
    { "provider": "vgjr-spotify", "ok": false, "error": "unavailable" }
  ]
}
```

Provider failures are isolated; a timeout or outage from one source does not cancel the others. Duplicate lyric bodies are removed. Results retain the provider ID for attribution and debugging.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Deploy to Vercel by importing this repository. The project uses a Node.js serverless function in `api/index.js`.

## Responsible use

Lyrics are copyrighted works owned by their respective rights holders. This project does not claim ownership of fetched lyrics. Review the terms, rate limits, and attribution requirements of each upstream provider before operating a public deployment. Respect upstream rate limits and do not use this service to bypass access controls.

## License

MIT. See [LICENSE](./LICENSE).
