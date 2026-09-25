# Terrain fixtures

`terrarium-12-1027-1474.png` — one Terrarium-encoded elevation tile (zoom 12, x 1027, y 1474), the
tile containing Rib Mountain, Wisconsin. Downloaded unmodified on 2026-09-24 from
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1027/1474.png`.

Source and attribution: Terrain Tiles, Mapzen / AWS Open Data Registry
(<https://registry.opendata.aws/terrain-tiles/>). The tiles combine several public elevation
datasets; for this area the underlying source is USGS 3DEP/NED (public domain). See the
[Terrain Tiles attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

Reference values used by `tests/unit/topoTerrainDecode.test.ts` were computed from this file with
Python's PIL, independently of the app's decoder:

- SHA-256 of the decoded RGBA bytes: `1fe056cc69f40c53293189c5f864f546e816e944fcb752722c013389a93f356b`
- pixel (0,0) → 368.3359375 m; (128,128) → 366.25 m; (255,255) → 362.7734375 m
- highest pixel (120,181) → 586.1796875 m (Rib Mountain's published summit height is 1,924 ft ≈ 586 m)

The golden pipeline fixtures (mountain, coast, flat) are synthetic tiles built in the tests
(`tests/helpers/terrarium.ts`), so they need no files here.
