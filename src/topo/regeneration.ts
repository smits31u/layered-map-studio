import type {TerrainSettings} from './terrain/pipeline';
import type {TopoProject} from './types';

// What regenerates terrain. The terrain worker reruns when, and only when, this key changes: the
// terrain layer count, coverage, contours and smoothing. It takes the whole project on purpose, so a
// test can change every other control (roads, labels, frame, title, route, compass, board size) and
// check the key does not move — the plan's "toggles and size controls update preview … when terrain
// does not need recomputation" starts with terrain not being asked to recompute.
//
// Board size is deliberately absent too: the frozen view fixes the board the terrain was generated
// for, and a size change after generation is reported by the page as needing a new generation from
// the map, not rerun silently at the wrong size.
export const terrainSettingsOf=(project:TopoProject,smoothingRadius:number):TerrainSettings=>({...project.terrain,smoothingRadius});

export const terrainRunKey=(project:TopoProject,smoothingRadius:number)=>JSON.stringify(terrainSettingsOf(project,smoothingRadius));
