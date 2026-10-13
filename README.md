# Adi Lyrics

A free, open-source lyrics aggregator API that queries multiple providers and returns a normalized response.

## Providers

- [LRCLIB](https://lrclib.net/)
- [lrc.red](https://lrc.red/)
- [VGJR Spotify lyrics](https://api.vgjr.top/lyrics/spotify?q=)
- [VGJR KuGou lyrics](https://api.vgjr.top/lyrics/kugou)
- [VGJR Shazam lyrics](https://api.vgjr.top/lyrics/shazam)
- [VGJR Tidal lyrics](https://api.vgjr.top/lyrics/tidal)
- [VGJR Deezer lyrics](https://api.vgjr.top/lyrics/deezer)

## API contract (planned)

`GET /api/lyrics?track=...&artist=...&album=...&duration=...`

Returns JSON with a consistent shape, a list of provider results, and provider status details. A provider outage should not prevent results from other providers from being returned.

## Development status

Initial repository bootstrap. Provider response formats and lrc.red lookup behavior must be verified against their current public API docs before enabling each adapter. Lyrics remain the property of their respective rights holders and providers; review each provider's terms and attribution requirements before deploying a public service.

## License

MIT. See [LICENSE](./LICENSE).
