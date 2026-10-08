// Reads an exported ornament SVG the way an importer does: by group id, from the path data alone.
// Cut groups are written as absolute M/L/Z polylines in sheet millimetres (svg.ts), so coordinates
// can be read straight off the `d` attribute without a geometry library.

export type SvgBounds={minX:number;minY:number;maxX:number;maxY:number};

export function svgGroup(svg:string,id:string):string|undefined{
 const escaped=id.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
 return new RegExp(`<g id="${escaped}"[^>]*>([\\s\\S]*?)</g>`).exec(svg)?.[1];
}

export const svgGroupPaths=(svg:string,id:string):string[]=>
 [...(svgGroup(svg,id)??'').matchAll(/<path d="([^"]*)"/g)].map(match=>match[1]);

export function pathCoordinates(d:string):[number,number][]{
 return [...d.matchAll(/[ML](-?[\d.]+(?:e-?\d+)?) (-?[\d.]+(?:e-?\d+)?)/g)].map(match=>[Number(match[1]),Number(match[2])]);
}

export function svgGroupBounds(svg:string,id:string):SvgBounds|undefined{
 const points=svgGroupPaths(svg,id).flatMap(pathCoordinates);
 if(!points.length)return undefined;
 return {
  minX:Math.min(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),
  maxX:Math.max(...points.map(p=>p[0])),maxY:Math.max(...points.map(p=>p[1])),
 };
}

// Closed rings in a group: one per `M`, since every ring the serializer writes starts with one.
export const svgGroupRingCount=(svg:string,id:string):number=>
 svgGroupPaths(svg,id).reduce((count,d)=>count+(d.match(/M/g)?.length??0),0);
