# mid-vallee.overpass.json — source and licence

**Data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.**
https://www.openstreetmap.org/copyright · https://opendatacommons.org/licenses/odbl/1-0/

This file is an unmodified extract of the OpenStreetMap database, kept as a test fixture for the
golf starter (docs/GOLF_MODULE_PLAN.md §9). If it is redistributed, or if a work produced from it is
shared publicly, the ODbL's attribution and share-alike terms apply to it.

- Course: Mid Vallee Golf Course, De Pere, WI. OSM way 29060461 (`leisure=golf_course`).
- Fetched: 2026-10-22T20:24Z from the public Overpass API (https://overpass-api.de/api/interpreter).
  The database snapshot timestamp (`osm3s.timestamp_osm_base`) is 2026-10-22T20:23:34Z.
- One request, HTTP 200, 458,725 bytes, 319 elements.
- Query: the course by name inside 44.30,-88.30,44.55,-87.90. Then, inside the course area or within
  50 m of its outline: `golf=*`, `natural=water|tree|wood`, `water=pond|lake`, `waterway=*`,
  `landuse=forest`, and `highway=*` ways with a `golf_cart` tag. Output is `out geom`.

```
[out:json][timeout:60];
nwr["leisure"="golf_course"]["name"~"^Mid[ -]?Vall",i](44.30,-88.30,44.55,-87.90)->.course;
.course out geom;
.course map_to_area->.a;
(
 nwr(area.a)["golf"];
 nwr(area.a)["natural"~"^(water|tree|wood)$"];
 nwr(area.a)["water"~"^(pond|lake)$"];
 nwr(area.a)["waterway"];
 nwr(area.a)["landuse"="forest"];
 way(area.a)["highway"]["golf_cart"];
 nwr(around.course:50)["golf"];
 nwr(around.course:50)["natural"~"^(water|tree|wood)$"];
 nwr(around.course:50)["water"~"^(pond|lake)$"];
 nwr(around.course:50)["waterway"];
 nwr(around.course:50)["landuse"="forest"];
 way(around.course:50)["highway"]["golf_cart"];
)->.f;
.f out geom;
```
