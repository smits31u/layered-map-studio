# Ornament generator — providers, licensing, attribution and self-hosting

Phase 5 item 4 of `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md`: "Document provider replacement, font
licenses, OSM attribution, and optional self-hosting."

This is the operator's page. It says what can be swapped, what has to be credited, and what changes
if you stop using the public services. Where a decision already has an ADR, this links to it rather
than restating it — the ADRs hold the reasoning, this holds the procedure.

- Why the geocoder is a server-side proxy at all, why the image runs Node, and why MapLibre is a
  pinned CDN script: [ADR 0003](adr/0003-geocoder-proxy-and-map-runtime.md).
- Why the ornament ships three fonts and what any fourth one must satisfy:
  [ADR 0002](adr/0002-font-licensing-and-bundling.md).
- Build and run commands, and the full `.env` list: [`README.md`](../README.md) and `.env.example`.

## What talks to the outside world

Four things, and only four. Everything else in the ornament path is local computation.

| Dependency | Default | Configured by | Used for |
|---|---|---|---|
| Vector tiles | `https://tiles.openfreemap.org/planet` | `VITE_ORNAMENT_TILES_URL` | The map you frame, and the roads and water a capture reads |
| Geocoder | Nominatim, Photon or US Census, via this app's own proxy | `NOMINATIM_URL`, `PHOTON_URL`, `CENSUS_GEOCODER_URL` | Turning a typed place into coordinates |
| Lake tool's map style | `https://tiles.openfreemap.org/styles/bright` | `VITE_MAP_STYLE_URL` | The lake tool only; the ornament builds its own style |
| MapLibre GL | `unpkg.com/maplibre-gl@5.6.2` | `index.html` | The interactive map runtime |

Fonts are **not** on this list: they are committed to `public/fonts/` and served by this app. Nothing
is fetched from a font CDN at build time, at run time or at export time, which is deliberate — see
ADR 0002.

## Replacing the tile provider

Everything the ornament assumes about the upstream tile schema is in one file,
`src/ornament/map/provider.ts`, as a `VectorTileProvider` record. That is the whole point of the
adapter: pointing the ornament at a different server is a config change, not a hunt through style
definitions.

For any OpenMapTiles-schema server, set `VITE_ORNAMENT_TILES_URL` to its **TileJSON** URL — not a
style URL. The ornament builds its own minimal style (`src/ornament/map/style.ts`) and only needs the
data.

```bash
VITE_ORNAMENT_TILES_URL=https://tiles.example.internal/planet
```

For a server with a different schema, add a second `VectorTileProvider` beside `OPENFREEMAP` and give
it that server's source-layer names and road-class property. The fields that matter:

- `sourceLayers.water` / `sourceLayers.transportation` — the source layers a capture queries.
- `roadClassProperty` — the feature property carrying the road classification (`class` in
  OpenMapTiles).
- `attribution` — see below; this string is what ends up in the exported file.

`checkProviderCompatibility()` runs against the live source once the map loads. If the required
source layers are missing, the app says so on screen instead of producing a blank export. A provider
swap that fails this check is a configuration error and is reported as one.

Road-class names are matched leniently on purpose. `ROAD_CLASS_TIERS` lists both the OpenMapTiles
folded classes (`minor`, `path`) and the raw OSM values some servers pass through unfolded
(`residential`, `footway`, …); a class that never appears simply never matches.

## Replacing the geocoder

Geocoding never goes direct from the browser — it goes through this app's `/api/geocode`, which is
what makes the provider policies enforceable at all (ADR 0003). Three adapters ship, in
`src/server/geocode/adapters/`: Nominatim, Photon and US Census.

Point any of them at a different instance with the matching environment variable:

```bash
NOMINATIM_URL=https://nominatim.example.internal
PHOTON_URL=https://photon.example.internal
CENSUS_GEOCODER_URL=https://geocoding.geo.census.gov
```

A self-hosted instance is a URL change and nothing else — the adapter's request shape and response
normalization are unchanged.

Adding a fourth provider means a new adapter module exporting the same interface, registered in the
proxy's provider list. It will then appear in the search UI's provider chooser automatically, because
the chooser is rendered from the list the proxy reports.

**`GEOCODER_CONTACT` should always be set.** Nominatim's usage policy requires a contactable
identifier in the User-Agent. When it is unset, the server warns at startup and the outgoing header
says the contact is not configured rather than pretending otherwise. If you run this against public
Nominatim without it, you are relying on someone else's goodwill and may be blocked.

Two policy behaviours are enforced server-side and are not configurable: one request per second to
public Nominatim, and no automatic fallback between providers. The second is a privacy decision —
a miss offers the other providers as buttons, because asking a second service about somebody's home
address is a choice the user should make knowingly.

## OpenStreetMap attribution

The tile and geocoding data are OpenStreetMap-derived and carry
[ODbL](https://opendatacommons.org/licenses/odbl/) obligations. Practically, that means the credit
has to travel with the work, and in this app it appears in four places:

1. **In the map preview** — `OPENFREEMAP.attribution` is rendered by `OrnamentPreview` as
   `.ornament-map-credit`, outside the circular mask. It is deliberately not MapLibre's own
   attribution control, which would be cropped away by the ornament's clip.
2. **Beside search results** — the answering provider's attribution string, returned by the proxy
   and rendered by `PlaceSearch`.
3. **In the exported SVG's metadata** — `src/ornament/export/metadata.ts` writes an `<lms:provider>`
   element carrying the attribution into every exported file. This is the one that matters most: the
   licence follows the derived work, not the browser tab it was made in, so an SVG that leaves this
   machine carries its own credit.
4. **In the exported project JSON**, alongside the settings needed to rebuild the piece.

**If you change the tile provider, change its `attribution` string to match.** It is not decorative
and it is not derived from the URL — it is copied verbatim into every file exported afterwards. A
provider swap that leaves the old attribution in place produces mislabelled output.

Selling a physical ornament made from OSM data is fine. ODbL attaches to the data and to derived
databases, not to a laser-cut object, but the exported SVG is a derived work and should keep its
credit. If you redistribute the SVGs themselves, keep the metadata block intact.

## Font licences

Three fonts ship, all SIL OFL 1.1: Inter, Cinzel and Great Vibes. Each `.ttf` in `public/fonts/` has
its full licence text beside it as `<Family>-OFL.txt`.

OFL permits redistribution and embedding, which is what makes exporting outlined text lawful — and
the ornament exports text as **paths, never as live text**, so the glyph outlines are baked into the
SVG and the recipient needs no font installed.

Adding a face is a five-point checklist, stated in full in ADR 0002. The short version: the licence
must permit redistribution *and* outline conversion for commercial use, the exact file is committed
rather than fetched, the licence text ships beside it, the face joins the `FontId` union so the
compiler enumerates it, and OFL Reserved Font Names are respected — an OFL face must not be renamed.

## Self-hosting

The app itself is already self-hosted: `docker compose up -d --build`, or `npm run build && npm run
serve`. What follows is about the four external dependencies.

**Geocoding** is the one most worth self-hosting, because it is the one carrying other people's
addresses. A self-hosted Nominatim (a country extract is enough for most shops, a planet import is
not required) or Photon removes the rate limit, removes the third-party privacy exposure, and is a
`NOMINATIM_URL` change here.

**Vector tiles** can be self-hosted with a planetiler/OpenMapTiles build served by tileserver-gl or
Martin. Point `VITE_ORNAMENT_TILES_URL` at its TileJSON. The schema check will tell you immediately
if the build is missing the `water` or `transportation` layers.

**MapLibre GL** is currently a version-pinned CDN script (ADR 0003, decision 3). To remove the CDN
dependency, take it as an npm dependency and drop the `<script>` from `index.html`; ADR 0003 records
this as a four-file change and lists them. Note that vendoring MapLibre does **not** make the app
work offline — the map is useless without remote vector tiles, and offline planet tiles are an
explicit non-goal in the plan.

**Fonts** need no action; they are already local.

### What self-hosting does not change

Capture and geometry limits are local and apply regardless of provider — a self-hosted tile server
serving a dense downtown hits the same feature and vertex ceilings, because those exist to keep the
export buildable, not to be polite to somebody else's server. See
[`ornament-implementation-status.md`](ornament-implementation-status.md) for those numbers.
