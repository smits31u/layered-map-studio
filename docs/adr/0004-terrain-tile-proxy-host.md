# ADR 0004 — Where the topo builder's terrain-tile proxy runs

Status: accepted (topo Phase 0). Implemented in topo Phase 2 and **deployed 2026-09-24** (image
`c9c7c59a627c`) — see "Implementation" and "Deployment" at the end.

## Context

The topo builder's plan (`docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md`, §Terrain acquisition) requires
Terrarium elevation PNGs to be requested through a same-origin `/api/terrain/:z/:x/:y.png`. The
proxy must:
- cache successful responses on disk;
- cap concurrency, starting at 6;
- report timeouts and errors;
- never let a failed cross-origin image silently poison the export canvas (§Known risks).

The plan's recommended shape puts this in a separate `apps/server`. This repository does not use
that shape (see the status document) and already runs a server: ADR 0003 made the production image
a single Node process, `server/index.ts`, which serves `dist/`, `/api/geocode` and `/health`. The
Vite dev server mounts the same geocode handler through a plugin.

The question is whether terrain tiles need a new server, or can extend that one.

## Decision

Extend the existing server. There is no new process, image, port or package.

The terrain proxy gets its own module, `src/server/terrain/`, laid out like `src/server/geocode/`:
- **Handler.** A pure handler with an injected fetch and cache, unit-testable without a socket.
- **HTTP route.** A narrow route mounted in the two places the geocode route already is: the
  production server's request switch and the Vite dev plugin.

Upstream is AWS Open Data Terrain Tiles in Terrarium encoding, overridable by a server-side
`TERRAIN_TILES_URL`, like `NOMINATIM_URL`. No key is required.

## Why

- **One extension covers both.** The geocoder proxy already solved the parts that are not
  tile-specific: a single origin, a server-side User-Agent, shared caching across tabs, one
  implementation in dev and production, and a minimal static server. A second server would
  duplicate all of it for one route. ADR 0003 rejected a Node sidecar for the same reason.
- **Tiles do not need the geocoder's policy machinery.** There is no one-request-per-second rate
  limit (AWS publishes none), and no provider chooser. The new pieces are narrow:
  - a concurrency semaphore instead of the geocoder's serializing queue;
  - a disk cache instead of the in-memory LRU;
  - binary PNG bodies instead of JSON.

## Consequences — what is genuinely new, beyond what earlier features needed

None of these is a new server or package. They are still more than the geocoder, ornament,
bathymetry or procedural terrain ever needed, so they are called out here rather than discovered in
Phase 2:

1. **A persistent, writable cache directory.** This is the first thing in this repository that
   needs one. The image runs as `USER node` with `/app` owned by root, so:
   - The Dockerfile must create and `chown` a cache directory, e.g. `/app/cache/terrain`.
   - `docker-compose.yml` must mount a named volume there, or the cache empties on every rebuild.
     The compose file has no volumes today (CLAUDE.md already notes this).
   - The cache needs a size bound and an eviction policy. It is a disk, not a Map that dies with
     the process.
2. **Binary responses.** The geocode route's response type writes strings only
   (`HttpResponseLike.end(body?:string)`). The terrain route gets its own response type that
   accepts bytes. The geocode route is not changed.
3. **Strict path validation.** `z`, `x` and `y` come from the request path and become both an
   upstream URL and a cache file name. They must be integers within `0 ≤ x,y < 2^z` and
   `z ≤ 15`, validated before either use. Otherwise the route is an SSRF or path-traversal vector.
4. **New outbound traffic.** The container will fetch from `s3.amazonaws.com`. That is worth
   knowing for anyone who firewalls the VM.

The plan's one-tile padding ring is not a server concern. It is part of the client's coverage
calculation, which decides which tiles to ask for. The proxy serves one tile per request.

Concurrency is capped at the proxy, so the limit holds across tabs. Phase 2 may also cap it in the
client's fetch pool, so one generation cannot queue hundreds of requests at the proxy.

## Implementation (topo Phase 2)

- **Route.** `GET|HEAD /api/terrain/<z>/<x>/<y>.png`, mounted exactly as the geocoder is: in
  `server/index.ts` for production and by a Vite plugin (`terrainApi()` in `vite.config.ts`) for
  `npm run dev` / `preview`. The geocode route and its response type are unchanged.
- **Code.** `src/server/terrain/`:
  - `tilePath.ts` — the only parser of request text: `^/api/terrain/\d{1,2}/\d{1,6}/\d{1,6}\.png$`,
    then safe-integer checks `z ≤ 15`, `0 ≤ x, y < 2^z`. Anything else is a 400 before the handler runs.
  - `handler.ts` — cache, then upstream through a semaphore (6 at once), 15 s timeout, in-flight
    dedupe. Upstream 403/404 → 404 `missing-tile` (never a blank tile); other failures → 502/504;
    a body that is not a PNG → 502.
  - `httpRoute.ts` — the binary route type (`end(body?: Uint8Array | string)`).
  - `tileCache.ts` — disk cache at `<dir>/<z>/<x>/<y>.png`, write-then-rename, oldest-first eviction
    above 2 GiB (`TERRAIN_CACHE_MAX_BYTES`).
- **Configuration.** `TERRAIN_CACHE_DIR` (image: `/app/cache/terrain`; dev: `.cache/terrain`,
  git- and docker-ignored), `TERRAIN_CACHE_MAX_BYTES`, `TERRAIN_TILES_URL` (defaults to the AWS
  Terrarium bucket).
- **Container.** The Dockerfile creates `/app/cache/terrain` owned by `node`. `docker-compose.yml`
  mounts the named volume `terrain-cache` there. Docker seeds a new named volume from the image
  directory, ownership included, so it starts writable. This was verified in a throwaway container:
  writable by uid 1000; a tile cached, then served as a hit after a restart and after a recreate.
- **Egress.** `s3.amazonaws.com` was reachable from the VM and from inside the running container as
  `node`.
- **Client concurrency.** The page's fetch pool also caps at 6 (`src/topo/terrain/fetchTiles.ts`),
  with a per-tile timeout and one abort for the whole generation.

## Deployment (2026-09-24)

- Rebuilt with `docker compose build --no-cache` and started with `docker compose up -d`. The
  container runs image `c9c7c59a627c`, is healthy, and mounts the named volume
  `layered-map-studio_terrain-cache` at `/app/cache/terrain` (owned by `node`).
- Verified live: `/health` returns ok; `/api/terrain/12/1027/1474.png` came back
  `X-Terrain-Cache: miss` and then `hit`, byte-identical to the checked-in fixture; an
  out-of-range tile returns 400. The lake tool (Artistic Depth, Procedural Terrain) and the ornament
  maker were smoke-checked in a browser with no console errors.
- Rollback: `layered-map-studio:rollback-pre-topo-terrain-proxy` (`f0e1d44d9034`, the image that
  was running before), with the pre-Phase-2 `docker-compose.yml`.
