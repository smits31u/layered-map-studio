// The golf course snapshot (docs/GOLF_MODULE_PLAN.md §2.2): one course's OpenStreetMap geometry,
// normalized once on the server and cached on disk, then turned into a board in the browser.
//
// Everything here is geographic: [longitude, latitude] pairs, GeoJSON order like the geocoder's
// candidates. Nothing is clipped to a board. The snapshot is cached by course and query version alone
// (`{osmType}-{osmId}-v{queryVersion}`), so it cannot depend on a board size or a margin; the browser
// clips when it builds the board (docs/golf-implementation-status.md, conflict 6).
//
// Like the rest of src/server/**, nothing here may import React, MapLibre or anything DOM-only. The
// browser imports these types, never the other way round.

export type LonLat=[number,number];
// Outer ring first, then holes. Rings are closed (first point repeated last).
export type GeoPolygonLL=LonLat[][];
export type GeoMultiPolygonLL=GeoPolygonLL[];

export type GolfOsmType='way'|'relation';

// Bumped whenever the Overpass queries or the normalization change what a snapshot contains. It is
// part of the cache key, so a bump makes every cached course refetch on its next request.
export const GOLF_QUERY_VERSION=1;

export const GOLF_SNAPSHOT_SCHEMA='layered-map-studio.golf-snapshot/1';

// What each feature is on the course. `water` is open water of any kind (natural=water, water=pond|
// lake, an area waterway, a water hazard); the hazard flavours are kept apart as well because they are
// tagged on their own and the coverage report counts them.
export type GolfAreaRole='fairway'|'green'|'tee'|'bunker'|'rough'|'water'|'wood'|'driving_range';
export type GolfLineRole='cartpath'|'stream';
export type GolfPointRole='tree'|'pin';

export interface GolfArea{id:string;role:GolfAreaRole;geometry:GeoMultiPolygonLL;hazard?:'water_hazard'|'lateral_water_hazard';ref?:string}
export interface GolfLine{id:string;role:GolfLineRole;coordinates:LonLat[]}
export interface GolfPoint{id:string;role:GolfPointRole;coordinate:LonLat}

// A hole's routing line runs tee to green: the plan's tee point is its first vertex and its green
// point its last. `nine` is the layout name on a multi-layout course (golf:course:name), so a
// 27-hole course's three "hole 1"s can be told apart.
export interface GolfHole{
 id:string;
 ref:string;
 number?:number;
 par?:number;
 handicap?:number;
 // Yardage per tee colour from dist:<colour>, and plain `dist` (or `distance`) under the key ''.
 // Numbers as tagged; OSM's dist is metres by convention, but courses tag yards often enough that
 // the snapshot does not convert, and nothing on the board depends on it.
 distances:Record<string,number>;
 nine?:string;
 line:LonLat[];
 tee:LonLat;
 green:LonLat;
}

// An 18-hole (or other) pairing of nines, from a golf=course relation: which nines it plays, in
// order, as far as its member holes say.
export interface GolfLayout{id:string;name:string;nines:string[];holeIds:string[]}

export type CoverageRole='holes'|'fairways'|'greens'|'tees'|'bunkers'|'rough'|'water'|'trees'|'cartpaths';
export const COVERAGE_ROLES:readonly CoverageRole[]=['holes','fairways','greens','tees','bunkers','rough','water','trees','cartpaths'];

export interface GolfSnapshot{
 schema:typeof GOLF_SNAPSHOT_SCHEMA;
 queryVersion:number;
 fetchedAt:string;
 // When OpenStreetMap's database last changed, as Overpass reports it.
 osmBase?:string;
 course:{osmType:GolfOsmType;osmId:number;name?:string;city?:string;state?:string;website?:string};
 boundary:GeoMultiPolygonLL;
 // [west, south, east, north] of the boundary.
 bbox:[number,number,number,number];
 areas:GolfArea[];
 lines:GolfLine[];
 points:GolfPoint[];
 holes:GolfHole[];
 // Nine names in the order their first hole appears, sorted by name; empty on a single-layout course.
 nines:string[];
 layouts:GolfLayout[];
 totals:{holes:number;par?:number};
 coverage:Record<CoverageRole,number>;
 // Elements that could not be used, by reason, so a half-mapped course says what it lost.
 skipped:Record<string,number>;
 attribution:string;
}

export const OSM_ATTRIBUTION='© OpenStreetMap contributors (ODbL)';
