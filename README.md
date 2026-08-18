# Layered Map Studio

Desktop-first, self-hosted tooling for dimensionally correct layered-map SVG manufacturing.

> **MapLibre locates geography. The geometry engine creates the physical product.**

True bathymetry is a V1 feature whenever verified depth-valued data is available. Decorative shoreline offsets are retained as an artistic fallback and are not bathymetric depth. See [`docs/bathymetry.md`](docs/bathymetry.md) for provider research, the normalized model, and current Caldron Falls limitations.

The fallback is labeled **Artistic Depth** and uses measured, product-relative normalized erosion rather than fixed millimeter offsets. See [`docs/artistic-depth.md`](docs/artistic-depth.md).

## Architecture

React controls a serializable `MapProject`. MapLibre supplies navigation, crop corner unprojection, and geographic vector source features. Geometry modules own Web Mercator crop projection, shoreline offsets, road filtering, and physical millimeter paths. A UI-independent manufacturing scene records cut/engrave/annotation semantics; the SVG serializer emits Production Sheet, Registered Layers, or individual panel files.

Key folders: `src/map`, `src/geometry`, `src/export`, `src/state`, and `tests/{unit,regression,fixtures}`.

## Polygon geometry

Manufacturing geometry is computed in projected millimeters, independently of MapLibre pixels. `polygon-clipping` performs water-fragment union, crop intersection, and `panel = product rectangle - water opening` differences. `clipper-lib` performs integer-scaled closed-polygon offsets; coordinates are scaled by 1000 for 0.001 mm precision and converted back before the final crop intersection.

The top sheet uses the normalized water opening. Successive shoreline sheets use positively expanded openings at the configured millimeter offsets, so opening area increases and remaining sheet area decreases down the decorative stack. The backer is always the complete product rectangle. Primary Water Body mode chooses the unioned component containing the project/search coordinate, falling back deterministically to an area-and-distance score; All Water retains every component above the configured physical-area threshold.

## Run

```bash
npm install
npm run dev                 # http://192.168.0.137:5173
npm test
npm run build
docker compose up -d --build # http://192.168.0.137:8080
```

Map style and Photon endpoints are configurable in `.env` using `.env.example`. The default OpenFreeMap style exposes OpenMapTiles-compatible `openmaptiles` source layers. Automated tests mock the provider boundary and never depend on external network availability. Run the Caldron Falls suite with `npx vitest run tests/regression`.

## Export modes

- Production Sheet: enabled panels side-by-side with deterministic millimeter gaps.
- Registered Layers: all enabled panels at origin 0,0.
- Individual SVG Files: one exact-size SVG download per enabled panel.

SVG groups carry explicit `data-operation` values, use millimeter dimensions, and contain no raster manufacturing content. Text outlining and ZIP packaging are not yet implemented, so manufacturing labels are deliberately absent rather than exported as live text.

## Manual LightBurn acceptance

Import the SVG; confirm physical size and named groups; confirm cut and engraving geometry; confirm no raster content; confirm text is outlined where required; confirm Production Sheet panels are separated; and confirm Registered Layers share an origin. This checklist is not a claim of completed manual LightBurn verification.

For the live Caldron Falls check: search for “Caldron Falls, Wisconsin,” fit/position the reservoir, set 14 × 11 inches, load visible vector features after tiles settle, generate, inspect, and export.
