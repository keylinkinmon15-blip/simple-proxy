# AVEN Cinema Public English HD–4K

Fusion / Stremio-compatible public addon with Cinemeta catalog/metadata/search and opt-in authorized provider aggregation. Stream labels require explicit English and resolution 720p–2160p. Provider labels are not measured or verified; playback depends on external licensed, public domain, or user-controlled sources.

Run: `node server.mjs`. Use `GET /manifest.json` as the add-on URL; `GET /health` shows provider count. To connect upstream Stremio-compatible add-ons set `AVEN_SOURCE_ADDONS` to JSON e.g. `[{"name":"My media","manifestUrl":"https://media.example/manifest.json"}]`. No providers are configured initially; catalog titles do not imply playable streams.
