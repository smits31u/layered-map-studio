import {strToU8,zipSync} from 'fflate';

// The deterministic ZIP every multi-file export in this app writes: the lake tool's individual
// panels and the golf starter's per-sheet files.
//
// ZIP timestamps are pinned instead of defaulting to "now" so the same files always produce
// byte-identical archive bytes — a re-export can be diffed against the one that went to the cutter.
// Built from local-time components on purpose: the ZIP header stores local time with no zone, and
// fflate reads it back the same way, so a fixed UTC instant would encode differently per timezone
// (and a UTC 1980-01-01 lands in 1979 west of Greenwich, outside the format's range entirely).
export const ZIP_MTIME=new Date(2000,0,1,12,0,0);

// Entries are written in the order given, so a caller that wants a stable archive passes a stable
// order. Text only: every file these exports produce is SVG, JSON or plain text.
export function deterministicZip(files:readonly (readonly [string,string])[]):Uint8Array{
 const seen=new Set<string>();
 for(const [name] of files){if(seen.has(name))throw new Error(`${name} appears twice in the ZIP.`);seen.add(name)}
 return zipSync(Object.fromEntries(files.map(([name,text])=>[name,strToU8(text)])),{level:6,mtime:ZIP_MTIME});
}
