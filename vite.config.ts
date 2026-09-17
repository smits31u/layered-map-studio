import {readFileSync} from 'node:fs';
import {defineConfig} from 'vitest/config';
import type {PluginOption} from 'vite';
import {createGeocodeHandler} from './src/server/geocode/handler';
import {GEOCODE_PATH,serveGeocode} from './src/server/geocode/httpRoute';

// The geocoder proxy has to exist in development too, otherwise `npm run dev` would have no
// `/api/geocode` and the only way to search would be the direct browser calls the plan forbids.
// This mounts the exact same handler the production server (`server/index.ts`) mounts, so there is
// one implementation of the rate limiting, caching and User-Agent policy rather than two.
const geocodeApi=():PluginOption=>{
 const handler=createGeocodeHandler();
 return {
  name:'layered-map-studio:geocode-api',
  configureServer(server){server.middlewares.use(GEOCODE_PATH,(request,response)=>{void serveGeocode({url:request.url,method:request.method},response,handler)})},
  configurePreviewServer(server){server.middlewares.use(GEOCODE_PATH,(request,response)=>{void serveGeocode({url:request.url,method:request.method},response,handler)})},
 };
};

// The app version reaches the bundle as a define rather than as an import of package.json: an
// exported cut file records which build produced it, and that string should not drag the whole
// manifest (dependency versions, scripts) into the client bundle to get there.
const pkg=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')) as {version:string};

export default defineConfig({
 plugins:[geocodeApi()],
 define:{__APP_VERSION__:JSON.stringify(pkg.version)},
 test:{environment:'jsdom',include:['tests/**/*.test.ts','tests/**/*.test.tsx'],setupFiles:['tests/setup.ts']},
});
