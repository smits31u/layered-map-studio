import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

// Guards a bug that shipped past every other test and only appeared in the production container.
//
// MapLibre's own stylesheet (loaded from the pinned CDN in index.html) sets
// `.maplibregl-map{position:relative}`, and MapLibre adds that class to whatever element it is
// given as a container. The ornament's map host is that element, so a bare
// `.ornament-map-canvas{position:absolute}` rule is a specificity tie — 0-1-0 against 0-1-0 — and
// the winner is decided purely by which stylesheet is linked last.
//
// That order is not stable. In dev, Vite injects the app's CSS as a runtime <style> appended to
// <head>, which lands after the CDN <link>, so the app's rule won and the map rendered. In the
// production build Vite emits the app's CSS as a <link> *before* the authored CDN <link>, so
// MapLibre's rule won, the host collapsed to zero height, and the map drew nothing — while still
// reporting no error, because MapLibre had initialised perfectly well into a box with no height.
//
// jsdom performs no layout and computes no cascade, so no component test can see this. What is
// assertable is the thing that made it possible: a selector that ties with a third-party rule
// instead of beating it. Scoping to `.ornament-map .ornament-map-canvas` makes it 0-2-0 and takes
// link order out of the equation.

const css=readFileSync(resolve(__dirname,'..','..','src','styles.css'),'utf8');

// Rules the ornament sets on elements MapLibre also claims, each paired with the MapLibre selector
// it competes with. Every one of these must out-specify its competitor rather than tie with it.
const CONTESTED=[
 {ours:'.ornament-map .ornament-map-canvas',bare:'.ornament-map-canvas',theirs:'.maplibregl-map'},
];

const ruleFor=(selector:string):string|undefined=>{
 // Selectors are matched with a boundary so `.ornament-map` does not match `.ornament-map-canvas`.
 const match=css.match(new RegExp(`(?:^|})\\s*${selector.replace(/[.\\+*?[^\\]$(){}|]/g,'\\$&')}\\s*\\{([^}]*)\\}`));
 return match?.[1];
};

describe('ornament map styling survives MapLibre stylesheet order',()=>{
 for(const {ours,bare,theirs} of CONTESTED){
  it(`positions the map host with a selector that beats ${theirs}`,()=>{
   const rule=ruleFor(ours);
   expect(rule,`expected a scoped rule for "${ours}"`).toBeDefined();
   expect(rule).toContain('position:absolute');
  });

  it(`does not declare the losing bare "${bare}" form`,()=>{
   // A bare rule would tie with MapLibre and silently depend on link order.
   expect(new RegExp(`(?:^|})\\s*\\${bare}\\s*\\{`).test(css)).toBe(false);
  });
 }

 it('gives the map host a real height, so MapLibre cannot initialise into a zero-height box',()=>{
  const rule=ruleFor('.ornament-map .ornament-map-canvas')!;
  expect(rule).toMatch(/inset:0|height:100%/);
 });

 it('keeps the map container itself positioned, since the host is absolute within it',()=>{
  expect(ruleFor('.ornament-map')).toContain('position:absolute');
 });
});
