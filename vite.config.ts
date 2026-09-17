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

export default defineConfig({
 plugins:[geocodeApi()],
 test:{environment:'jsdom',include:['tests/**/*.test.ts','tests/**/*.test.tsx'],setupFiles:['tests/setup.ts']},
});
