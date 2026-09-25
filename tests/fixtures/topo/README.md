# Topo builder fixtures (real, recorded)

Two real places, recorded rather than generated. Phase 2's goldens were synthetic, and Phase 3
exists to fix something only real data showed: a coastal board layered the sea floor as land.

| Fixture | View | Contents | Size |
|---|---|---|---|
| `sf-coast/` | The Golden Gate at map zoom 12: strait and bridge, Marin Headlands, Presidio. A 9 in board, 400 px crop frame, centred on terrain tile 12/654/1582. | Rendered water and roads, and the 9 Terrarium tiles the pipeline plans for that view. | 96 KB + 9 × ~100 KB PNG |
| `sf-city/` | Downtown San Francisco at the plan's default zoom 14: Union Square, Nob Hill, Chinatown, SoMa. A 9 in board, 400 px frame, centred on a vector-tile corner so the capture spans four tiles. | Rendered water, roads and labels. No terrain tiles. | 371 KB |

## What is recorded

`rendered.json.gz` holds exactly what MapLibre's `queryRenderedFeatures` returned for the capture's
own queries, before any dedupe, on the real OpenFreeMap basemap style:
- properties trimmed to the ones the capture reads (`class`, `name`, `rank` and so on);
- the style's layer list, from which layers are discovered by source-layer;
- the map element's size;
- what `captureTopoFeatures` itself returned in the browser from those queries (`expected`).

`tests/helpers/topoFixtures.ts` replays the queries through `captureTopoFeatures` against a map that
answers with them. Tests assert the replay equals `expected`, so the replay is a faithful stand-in
for the live map.

The tiles are the Terrarium PNGs byte for byte, as the app's `/api/terrain` proxy served them.

## How they were recorded

With the recorder in `record/`, which runs the app's own capture code in a real browser:

```
npm run dev                                      # the Vite dev server, for /api/terrain and the page
node tests/fixtures/topo/record/record.mjs sf-coast [http://127.0.0.1:5173]
node tests/fixtures/topo/record/record.mjs sf-city
```

It drives headless Chromium over the DevTools protocol. Set `CHROME`, or it uses Playwright's cached
headless shell. It loads the same pinned MapLibre build as `index.html` (5.6.2) and the basemap the
topo map shows (`VITE_MAP_STYLE_URL`, default OpenFreeMap "bright"). Re-running it on 2026-09-25
reproduced both recordings exactly; only the `recordedAt` field changed. Upstream data does change
over time, and a later re-recording will differ; the tests pin what these files contain.

The recorder is never run by the test suite, and the tests make no network calls.

## Attribution

- Water, roads and labels: © OpenStreetMap contributors (ODbL), vector tiles by OpenFreeMap
  (OpenMapTiles schema). These files are small extracts kept for testing, not a redistributed
  dataset.
- Elevation: Terrain Tiles, Mapzen / AWS Open Data Registry
  (<https://registry.opendata.aws/terrain-tiles/>). The tiles blend several public datasets,
  bathymetry among them, which is why the strait bed appears in them at all. See the
  [Terrain Tiles attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
