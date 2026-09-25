// Terrain generation failures the user has to be told about, each with a stable code so the UI and
// the tests can tell them apart without parsing messages. The code survives the worker boundary
// (structured cloning drops an Error's prototype, so the worker posts `code` alongside the message).

export type TerrainErrorCode=
 // A tile the terrain source does not have. Never papered over with sea level (the plan's rule).
 |'missing-tile'
 // A tile that could not be fetched: network failure, proxy error, timeout.
 |'tile-fetch-failed'
 // A tile that arrived but is not a decodable Terrarium PNG.
 |'invalid-tile'
 // The frozen view cannot be generated: bad bounds, or more tiles than the budget.
 |'invalid-view';

export class TerrainError extends Error{
 constructor(readonly code:TerrainErrorCode,message:string){super(message);this.name='TerrainError'}
}

export const isTerrainErrorCode=(value:unknown):value is TerrainErrorCode=>
 value==='missing-tile'||value==='tile-fetch-failed'||value==='invalid-tile'||value==='invalid-view';
