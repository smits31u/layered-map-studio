# ADR 0003 — Geocoder proxy scope, its host process, and how MapLibre is loaded

Status: accepted (Phase 2)

Three decisions that Phase 2 forced, recorded together because they are entangled: the first one
requires a server, the second one is that server, and the third is what the map does now that a
server exists.

## 1. The geocoder proxy replaces the direct browser calls everywhere, not just for the ornament

### Context

The plan's §Geocoding plan requires `/api/geocode?q=...` on localhost with a descriptive server-side
User-Agent, a one-request-per-second cap for public Nominatim, response caching, up to five
normalized candidates, and swappable provider adapters with no automatic fallback.

The repository already had `src/map/geocoding/GeocoderService.ts`, which the lake map tool uses for
place search and marker address lookup. It called `photon.komoot.io` and
`nominatim.openstreetmap.org` straight from the page. That violates all four policy points at once,
and three of them are unfixable in a browser: the User-Agent is the browser's, the rate limit cannot
be coordinated across tabs, and a cache would be per-page.

The choice was whether to build the proxy as ornament-only and leave the lake tool's direct calls
alone, or route both through it.

### Decision

Route both through it. The provider-specific code — URL shapes, response normalization, rate policy,
attribution — moved from the browser classes into `src/server/geocode/adapters/`, and
`GeocoderService.ts` became a client for `/api/geocode`.

### Why

The alternative ships two geocoding paths in one binary, one compliant and one not, with nothing
stopping the next feature from picking the wrong one. It is also not, in practice, a bigger change:
the normalization code had to exist server-side regardless for the proxy to return normalized
candidates, so retrofitting was mostly deleting the browser copy rather than writing a new one.

The lake tool's observable behaviour is deliberately unchanged. `FallbackGeocoder` still exists and
still advances to a second provider only on an outright failure or an empty result — it was never
the "fire a fallback for every ambiguous result" pattern the plan forbids — and its hops now go
through the proxy. The ornament does not use it: its result chooser names the provider that answered
and offers the others as buttons.

### Consequences

- `PhotonGeocoder` and `NominatimGeocoder` no longer exist. `ProxyGeocoder` replaces both.
  `src/components/controls/Controls.tsx` was updated; `MarkerCard.tsx` needed no change.
- `tests/unit/geocoder.test.ts` was rewritten: it now tests the client, and the provider parsing it
  used to cover moved to `tests/unit/geocodeProxy.test.ts` against the adapters.
- The app can no longer be served as bare static files — see decision 2.
- Geocoding now fails with an explanatory error (`proxy-unreachable`) if someone opens `dist/`
  directly from the filesystem. That is a real regression in one narrow case, and it is preferred to
  the alternative of keeping a policy-violating fallback path alive for it.

## 2. The production image runs Node, not nginx

### Context

The build output was static files served by `nginxinc/nginx-unprivileged`. A static file server
cannot answer `/api/geocode`.

### Decision

The production image is `node:22-alpine` running `server/index.ts` (built to `dist-server/`), which
serves the same `dist/` plus the proxy route and `/health`. `nginx.conf` is deleted. The dev server
mounts the identical handler through a Vite plugin, so there is one implementation of the policy.

### Why

The considered alternative was keeping nginx for static files and adding a Node sidecar with
`proxy_pass /api/`. That is two images, two processes and a proxy rule for one endpoint, on a tool
that runs on a workbench. A single Node process is the smallest arrangement that works, and it keeps
the existing contract: same port, same `/health`, same compose file, same SPA fallback that
`try_files ... /index.html` provided.

### Consequences

- `npm run build` now also runs `npm run build:server`; `npm run serve` runs the result.
- `GEOCODER_CONTACT` should be set. Nominatim's policy requires a contactable identifier; when it is
  unset the server warns at startup and the outgoing User-Agent says so rather than pretending.
- Static serving is now this repository's code and therefore this repository's problem. It is
  deliberately minimal — GET and HEAD only, path traversal contained by resolving inside the build
  root, no directory listing, no compression — and is covered by the checks in the Phase 2 report.

## 3. MapLibre stays a version-pinned CDN script for now

### Context

`index.html` loads `maplibre-gl@5.6.2` from unpkg and the lake tool reaches it through
`declare const maplibregl:any`. The Phase 1 status document flagged the choice as Phase 2's to make:
keep it, or take MapLibre as an npm dependency for lockfile pinning and real types.

### Decision

Keep the pinned CDN script. Add `src/ornament/map/maplibreGlobal.ts`, a narrow typed facade
declaring only the map surface the ornament uses.

### Why

The usual argument for vendoring — working offline — does not apply. The map is useless without
remote vector tiles, and "full offline planet tiles" is an explicit non-goal in the plan. So the
dependency buys lockfile pinning and types, and the URL is already version-pinned while the facade
supplies the types. Against that, adopting the npm package means editing `index.html`, `main.tsx`
and the shipped lake tool's `MapViewer.tsx`, and pulling roughly 800KB into a bundle that a jsdom
test already imports (`tests/unit/queryBox.test.ts` imports from `MapViewer.tsx`) — churn in a
shipped tool during a phase whose exit criteria are about map and search.

### Consequences

- The ornament's map code is typed; the lake tool's `any` is untouched and can be migrated later.
- Revisit when Phase 3 needs deeper API surface (`queryRenderedFeatures` typings in particular), or
  if the CDN becomes a problem. It is a four-file change whenever it is wanted.
- `supportsInteractiveMap()` degrades to a message rather than throwing where WebGL or the global is
  absent, which is also why the jsdom component tests can render the whole ornament page.
