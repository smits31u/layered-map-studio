# Bundled fonts

All three fonts are from Google Fonts (`google/fonts` repo) under the SIL Open Font License 1.1
(see the accompanying `*-OFL.txt` files) — free to bundle, use, and redistribute.

- `Inter-Regular.ttf` — Inter, instantiated from the variable font to a static Regular (wght=400, opsz=14) instance.
- `Cinzel-Regular.ttf` — Cinzel, instantiated from the variable font to a static Regular (wght=400) instance.
- `GreatVibes-Regular.ttf` — Great Vibes, already a static font.

All three had their `GSUB`/`GPOS`/`GDEF`/`DSIG` tables stripped with fonttools. Layered Map Studio's
vector-outline engine (opentype.js) only needs plain glyph outlines (`glyf`/`cmap`/`hmtx`), not
OpenType Layout features (ligatures, contextual substitution, kerning pairs) — and opentype.js
cannot currently parse one of the lookup types Inter's and Great Vibes' original GSUB tables use
(chained contextual substitution, format 2), which made the unmodified files fail to parse at all.
Stripping those tables is a valid, license-compliant modification under OFL and produces smaller,
purpose-fit files with identical glyph shapes.
