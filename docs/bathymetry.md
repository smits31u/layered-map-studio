# V1 bathymetry architecture and source research

True bathymetry is a V1 feature. Decorative shoreline offsets remain an explicitly artistic fallback and are never labeled as measured depth.

## Provider findings

| Provider | Coverage and access | Data type / resolution | Terms and practical status |
| --- | --- | --- | --- |
| Wisconsin DNR | The official Wisconsin Lakes page identifies inland waters by WBIC and links available historical contour maps. DNR hydrography is queryable through its public ArcGIS REST service. | Coverage varies by lake. Many contour products are scanned historical survey PDFs rather than georeferenced GIS. | DNR website terms and map disclaimers apply. Preserve attribution and “not for navigation.” Programmatic waterbody discovery is practical; scanned-map contour ingestion requires georeferencing and digitization. |
| NOAA/NCEI | Great Lakes bathymetry provides downloadable contour shapefiles and ARC ASCII, binary float, GeoTIFF, NetCDF, GRD98, and XYZ grids. | Lake Michigan contours are 5 m intervals at 1:250,000 compilation scale; other Great Lakes products vary. | NCEI says primarily NCEI-derived products are not subject to U.S. copyright protection and requests source acknowledgement/DOI citation. Practical for a future Great Lakes vector/grid provider. |
| USGS | The Inland Bathymetric and Topobathymetric Survey Inventory is a public, irregularly updated inventory with XLSX/GDB access and dataset links; 3DEP/CoNED provide survey-specific products. | Survey methods, dates, formats, resolution, datum, and accuracy vary. Coverage is not universal. | Public government data with dataset-specific citations/disclaimers. Practical as discovery plus per-dataset adapters, not as one universal inland API. |
| User supplied | V1 accepts georeferenced GeoJSON Polygon/MultiPolygon depth regions. | Each feature must carry `depth` or `depth_value`, and `depth_unit` or `unit` (`m`, `meters`, `ft`, or `feet`). | User must verify rights, georeferencing, topology, and accuracy. Imported metadata is retained and marked not for navigation. |

Official references:

- Wisconsin DNR Caldron Falls facts/WBIC: https://apps.dnr.wi.gov/lakes/lakepages/LakeDetail.aspx?page=facts&wbic=545400
- Official Caldron contour document: https://apps.dnr.wi.gov/swims/Documents/DownloadDocument?id=29814911
- Wisconsin DNR hydrography ArcGIS layer: https://dnrmaps.wi.gov/arcgis/rest/services/ER_Biotics/ER_Biotics_WGS84_Hydro/MapServer/0
- Wisconsin DNR legal notices: https://dnr.wisconsin.gov/legal
- NOAA/NCEI Great Lakes bathymetry: https://www.ncei.noaa.gov/products/great-lakes-bathymetry
- USGS inland bathymetry: https://www.usgs.gov/3d-elevation-program/inland-bathymetry
- USGS survey inventory v3: https://doi.org/10.5066/P9PDX9X3

## Caldron Falls Reservoir

Wisconsin DNR identifies Caldron Falls Reservoir as WBIC `545400`, 1,063 acres, maximum depth 40 ft, mean depth 15 ft. Its official bathymetric source is a June 1967 sonar lake-survey map. The downloadable PDF title marks it historical and not for navigation. Inspection shows two 72-DPI scanned raster map sheets plus a metadata page; it has no vector contours or embedded georeferencing. The map contains actual depth soundings and contours in feet, commonly at 5-foot intervals, and identifies a 40-foot maximum.

The PDF is programmatically downloadable, but reliable automatic contour ingestion is not currently possible without control-point georeferencing, raster cleanup, contour/value digitization, topology repair, and validation against modern shoreline geometry. Layered Map Studio therefore discovers the DNR waterbody and reports the scan honestly; it does not convert shoreline offsets into fake Caldron depth.

## Normalized model

Providers normalize into a serializable `BathymetryDataset`: source/provider metadata, dataset ID and date, internal meter units, depth range, and polygonal `area at least this depth` regions. True-depth regions use the canonical crop projection, intersect the selected primary waterbody, intersect the physical crop, and are nested by intersection with the previous shallower region. Automatic thresholds select supported source levels across the available range; manual mode selects only source-provided levels.

The current browser import deliberately accepts polygonal depth regions, not unreferenced SVG, raster PDF, raw GeoTIFF, shapefile, or XYZ points. Those formats need geospatial parsing/contouring work and must not be treated as trustworthy merely because they can be opened.
