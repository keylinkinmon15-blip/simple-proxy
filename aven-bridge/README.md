# AVEN Torrent Bridge — experimental local prototype

A private torrent-to-HTTP bridge written for AVEN. It does not use Webtor or debrid APIs. This is a local prototype, not a deployed Fusion addon or a movie search service.

## Included
- WebTorrent engine; one allowlisted torrent at a time. Default allowlist contains only the openly licensed Sintel demo from WebTorrent's documentation.
- Token-protected file listing, status and MP4 streaming endpoints.
- HTTP Range/HEAD support for seeking; one simultaneous playback request.
- 200 MiB file limit and 256 MiB process transfer budget accounting for torrent download, torrent upload and served video. In-flight chunks can exceed a network threshold before shutdown. This is not a provider billing cap.
- Two-minute inactivity cleanup of torrent data. No transcoding, torrent search, Pirate Bay integration or Fusion manifest yet.

## Run locally
Requires Node.js 24 and npm. Run `npm ci` (native dependencies may need build tools). Set BRIDGE_TOKEN to a random secret of at least 24 characters using your shell's secret/environment facilities, then run `node server.mjs`. The server listens only on 127.0.0.1:8099.

Send `Authorization: Bearer YOUR_TOKEN` to authenticated routes. Never publish the token or put it in a URL.

GET /files/08ada5a7a6183aae1e09d831df6748d566095a10 lists the demo files.
GET /video/08ada5a7a6183aae1e09d831df6748d566095a10/INDEX serves the selected MP4.
GET /status shows transfer usage. /health exposes a minimal health result without authentication.

`node --test test.mjs` tests authentication, unknown hashes, range requests, suffix ranges, HEAD and cap rejection using a fake torrent engine. `node smoke.mjs` attempts real torrent metadata and a 1 KiB media range for Sintel; it needs access to real peers.

## Hosting boundary
This prototype has not been deployed to Render. Its counters reset on process restart, so they do not enforce monthly account spending or prevent all bandwidth billing. It has no persistent monthly quota store. Do not expose it publicly until persistent quotas, peer/network isolation, deployment testing and a Fusion-compatible authentication adapter are implemented. A token-protected localhost endpoint cannot simply be pasted into Fusion as an add-on.

Rendering compatibility also depends on the source file's codecs. MP4 container detection alone does not guarantee Apple TV playback.

## Validation in this session
- HTTP and range tests passed.
- Real local BitTorrent peer -> HTTP range transfer passed (1000 bytes matched). Run `node local-peer-test.mjs` to reproduce. The fixture uses random bytes, not a playable movie.
- Public Sintel metadata lookup timed out after 25 seconds in this environment. Internet torrent streaming and hosted operation remain unverified.

## Hosted experiment additions
The entry point binds to 0.0.0.0 on Render and uses a 16 MiB process transfer budget for the torrent experiment. `/manifest.json` forwards existing AVEN HTTP sources with clean labels. `/bridge/manifest.json` supplies only the Sintel test. Demo media links have HMAC signatures; the token stays in the server environment. Production status/file endpoints still require Bearer authentication. This experiment does not search arbitrary movie torrents.
