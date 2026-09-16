# ADR 0002 — Font licensing and bundling for ornament text

- Status: accepted
- Date: 2026-09-16
- Context: `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md`, Phase 0 ("ADRs for polygon/buffer engine and font
  licensing")

## Context

Every string in manufacturing output is converted to glyph outlines before export. That makes the
font file itself a build input, not a presentation detail — the exported SVG contains derived
outline data from it.

Two constraints from the plan:

- §Reference behavior not to reproduce: "It relies on remotely fetched fonts. Bundle versioned,
  redistributable fonts locally."
- §Risks: "bundle exact font versions and licenses; never depend on a remote 'latest' URL during
  export."

The reference generator offers eight script/serif choices for the main title.

## Decision

**Reuse the lake tool's existing bundled-font mechanism unchanged, and ship the ornament on the
three fonts already bundled.**

`src/text/fontRegistry.ts` already satisfies every requirement in the plan: three SIL OFL fonts
(Inter, Cinzel, Great Vibes) served from `public/fonts/` with their `*-OFL.txt` licence files
beside them, loaded from a same-origin URL, cached, with a synchronous accessor so the
non-async manufacturing pipeline can never race the load. There is no remote fetch at export time
and no dependency on a font installed on the operator's machine.

Adding a parallel font system for the ornament would duplicate that with no benefit, so
`OrnamentProject`'s `TextLine.fontId` is typed as the existing `FontId` union rather than the
plan's looser `fontId: string`.

**Expanding to eight title faces is deferred, and gated on licence review per face.**

## Rationale for deferring

Eight faces is a verified observation about the *reference* tool, not a fabrication requirement,
and the plan forbids copying its design choices anyway ("original interface", "original ornament
geometry"). Matching its font count exactly is closer to cloning than to meeting a need.

More practically: each added face costs a licence review, a redistributable file committed to
`public/fonts/`, its licence text beside it, and a permanent support obligation — the exported
outlines are derived work, so a face that turns out to be non-redistributable invalidates
customer files already cut. Three known-good OFL faces are enough to prove the text pipeline in
Phase 1, which is what Phase 1's exit criteria actually require.

## Requirements on any future font addition

1. The licence must permit redistribution **and** embedding/outline conversion for commercial
   work. SIL OFL, Apache-2.0, and CC0 qualify. "Free for personal use" does not.
2. The exact `.ttf`/`.otf` is committed to `public/fonts/`, never fetched at build or export time.
3. The full licence text ships beside it as `<Family>-<LICENCE>.txt`, matching the existing
   `public/fonts/*-OFL.txt` convention.
4. The face is added to `FONT_REGISTRY` and the `FontId` union, so the type system enumerates
   exactly what is shippable.
5. Reserved Font Names under OFL are respected — OFL faces must not be renamed.

## Consequences

- Ornament and lake tool share one font cache; a face loaded by one is already warm for the other.
- `FontId` being a closed union means adding a face is a typed change with compiler-enforced
  follow-through, rather than a string that silently fails to resolve at runtime.
- The ornament's title currently defaults to Great Vibes (the only script face bundled). If user
  testing shows three faces is genuinely too few for a personalisation product, that is a product
  decision that reopens this ADR — the mechanism does not need to change, only the file count.
