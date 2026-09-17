FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# The app used to ship as static files behind nginx. It cannot any more: the plan requires geocoding
# to go through a localhost proxy at /api/geocode (descriptive User-Agent, one request per second to
# Nominatim, server-side caching), and a static file server has nowhere to run that. This image runs
# the same built dist/ behind a small Node server that also answers the proxy route.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 STATIC_ROOT=/app/dist
# Set GEOCODER_CONTACT to an address whoever runs this instance can be reached at. Nominatim's usage
# policy requires it; without it the outgoing User-Agent says so rather than pretending otherwise.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node","server/index.js"]
