# Atomm Lake Map Generator — handoff for Claude Code

> **Status: Atomm work is shelved until Nov/Dec 2026.**
>
> Superseded where it conflicts with docs/ATOMM_AUDIT_2026-09-29.md (the lake tool has no workers or persistence; see audit for verified build state).

**Repo:** `~/projects/layered-map-studio` (Unraid VM, user `smits31u`)
**Goal:** publish a lake-only version of the lake depth tool as a public Generator on Atomm (xTool's creator platform), without changing the existing app at `maps.oldglorydecor.com`.

This doc covers what is specific to this project. Atomm's own rules live in their docs and skill. Do not restate or guess them. Read them.

---

## 0. Read before planning

1. `https://dev.atomm.com/llms.txt`: index of all Atomm developer docs. Fetch individual pages by appending `.md` to a docs URL. Do not load `llms-full.txt` unless the index is not enough.
2. `.claude/skills/atomm-design/SKILL.md`: Atomm's `design.md`. It requires fetching the matching layout skeleton before writing any UI markup. Follow that rule. If the skill file is missing or has no YAML frontmatter, stop and tell Ben.
3. Minimum Atomm pages to read: `docs/quickstart`, `docs/export`, `docs/export/svg-color-spec`, `docs/design/platform`, `docs/design/layout`, `docs/publish`, `docs/devtool`.
4. The existing repo `CLAUDE.md` and project docs, for how the lake tool, procedural depth mode, and export pipeline currently work.

Then write a short plan naming the files you will add or change. Do not start coding until Ben approves the plan.

## 1. Repo lessons from earlier sessions (these have burned us before)

- Confirm the working directory and machine at the start. Sessions have run on the Windows desktop when the code lives on the VM.
- "Tests pass" and "committed" do not mean "deployed." When claiming something works, state the branch, the commit, and whether you checked the dev server or the built output.
- Don't touch the running Docker container or the main app's UI as part of this work.

## 2. Scope

**In the Atomm build:**
- Place/lake search
- Depth layers with **Procedural Terrain as the default mode**, offset-ring (Artistic Depth) as a secondary option
- Layer count (3–7), board size
- Title plaque (text to paths)
- Compass
- Export through the Atomm SDK

**Out of the Atomm build (stays in the Old Glory version only):**
- Road labels and road rendering
- Address markers
- True Bathymetry / GeoJSON import
- Ornament, topo, and bathymetry sub-tools
- Project save/load, and any Old Glory branding
- 3D preview (possible later version, using Atomm's `3d-preview-skill.md`)

## 3. Architecture

- **Separate entry point and build target.** Something like `src/atomm/` with its own Vite config/entry, building to a separate output directory. The existing app's build must be unaffected.
- **Reuse, don't fork:** geometry, procedural terrain engine, workers, and SVG assembly are imported from existing modules. If a shared module needs a change, make it backward compatible and keep the main app's tests passing.
- **UI is new**, built on the Atomm skeleton from the design skill. Do not port the current sidebar, header, or theme. Do not apply the patch tool design tokens to the Atomm build (those are for `maps.oldglorydecor.com` only).
- The platform owns the top bar. Our controls go in the parameters rail. The export button is Atomm's SDK-rendered button in its designated slot.

## 4. Backend (the main blocker; Ben must decide this before phase 3)

Atomm hosts only the static frontend. Anything needing a server has to be publicly reachable from `atomm.com`.

- **Geocoding:** the Atomm build must NOT call public Nominatim or Photon directly from users' browsers (policy violation at public traffic levels). It calls our own endpoint, which caches results and rate-limits.
- **Do not expose `maps.oldglorydecor.com`** or open a new public route into the home network for this without Ben's explicit sign-off.
- **Recommended:** a Cloudflare Worker (geocode proxy + cache) so Atomm traffic never hits the Unraid box. Alternative: Unraid endpoint behind Cloudflare. **Ben decides.** Write an ADR either way.
- CORS: allow only the Atomm origins actually observed during `?local=` testing. Don't use a wildcard.
- **Map tiles:** confirm whether OpenFreeMap tiles load directly inside the Atomm runtime. If the runtime blocks them, report it. Do not silently add a tile proxy.
- Terrain/elevation is not needed for the lake-only build. If the procedural mode depends on anything server-side, flag it.

## 5. Export

- Output is machine-facing: 1:1 physical size, `mm` units, viewBox in mm.
- Add an **Atomm color preset** used only by the Atomm build: cut strokes `#FE0002`, stroke engraving `#2366FF`, fill engraving `#2366FF`. The existing LightBurn/xTool Studio preset for the main app stays unchanged.
- Emit real `path` elements. **No `<use>`**, and no geometry inside `<defs>`/`<symbol>`. Colors as plain hex attributes or inline style (no CSS variables, no `currentColor`, no named colors).
- Multi-file (one SVG per layer) is allowed. Confirm the final format against the Atomm export docs.
- Add a test that parses an exported Atomm SVG and asserts: mm units, correct viewBox, only spec colors on cut/engrave elements, no `<use>`, no NaN/Infinity.

## 6. Labeling and attribution

- Depth layers are labeled as **modeled / decorative**, never as depth soundings or surveyed data. Include a short "not for navigation" note.
- Show "© OpenStreetMap contributors" in the UI.

## 7. Local testing inside Atomm

- Atomm's DevTool previews via `?local=` and accepts **loopback addresses only**.
- Dev server runs on the VM, so Ben tunnels it to his desktop:
  `ssh -L 5173:localhost:5173 smits31u@100.64.163.25`
  then opens:
  `https://www.atomm.com/creativetools/community/generator/<generator-name>?local=http://localhost:5173/`
- Chrome may prompt for local network access. Allow it.
- The generator must be created in the Developer Console first to have a name. See section 9.

## 8. Packaging

- Static bundle zipped, **50 MB max**.
- Add a packaging script plus a check that fails if the built `index.html` does not contain the Atomm `platform-sdk.js` script tag. Atomm specifically warns that builds dropping it break export after publishing.

## 9. Listing (Ben does this in the Developer Console)

- **Generator name is permanent** (becomes part of the URL). Proposed: `lake-map-generator`. Ben confirms before creating.
- Card title and short description should say "lake map" plainly.
- Cover: 4:3, a photo of a real cut piece, subject centered (Atomm auto-crops a 1:1 version from the center).

## 10. Phases and exit criteria

**Phase A — pre-flight (Ben, no code):**
Read Atomm developer terms (IP/ownership). Run procedural mode on 3–4 more Wisconsin lakes and eyeball them. Open Atomm's Classic Map Generator, frame a lake, and note what it can and can't do.

**Phase B — Atomm entry point:**
Skeleton-based UI, lake search (temporarily via the existing geocoder for dev only), depth layers, title, compass, preview. Exit: runs locally, main app build and tests still pass.

**Phase C — export:**
SDK integration, Atomm color preset, export tests. Exit: export works inside Atomm via `?local=`, and the exported file imports into xTool Studio at correct size with cut/engrave auto-recognized.

**Phase D — backend:**
Implement the approved geocoding option. Exit: Atomm build makes zero direct calls to public Nominatim/Photon (verify in the network tab), cached repeat searches work.

**Phase E — package and submit:**
Packaging script and SDK check, listing assets. Exit: zip uploaded and submitted for review.

## 11. Report at the end of each phase

- Files added/changed
- Exact commands run and results (typecheck, tests, build)
- What was checked in the Atomm DevTool vs. only locally
- Open decisions for Ben
- Next phase
