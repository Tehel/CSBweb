# The deployed game (`doc/DEPLOYMENT.md`): `server/` on Node 24, over the built page.
# The game files and the statistics are mounted, never in the image:
#
#   /data/gamefiles   the data sets and their manifest.json, and the folders players' sets are
#                     uploaded to, written here
#   /data/stats       stats.db: the statistics, and the data sets, filled once from the manifest;
#                     backups/: its snapshots and the uploaded folders' copies
#
#   docker build --build-arg CSBWEB_BUILD=$(git rev-parse --short HEAD) -t csbweb .
#
# CSBWEB_BUILD names the build in the page's events: the build stage has no `.git`.
# CSBWEB_PROBE=1 builds the page with the probes' handle, for the golden frames
# (`tools/check-frames.sh --url`), and is never deployed.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG CSBWEB_BUILD=unknown
ARG CSBWEB_PROBE=
RUN CSBWEB_BUILD="$CSBWEB_BUILD" CSBWEB_PROBE="$CSBWEB_PROBE" npm run build

FROM node:24-alpine
WORKDIR /app
# No node_modules: the server has no dependency. `package.json` is there for its
# `"type": "module"`, and `DataSets.ts` is the page's manifest parser, which the server
# imports from `../src/data/`. `dist/server/` is the page's check of a player's set,
# bundled for Node, which the server loads at start-up.
COPY package.json ./
COPY server/ server/
COPY src/data/DataSets.ts src/data/DataSets.ts
COPY --from=build /app/dist/ dist/
ENV PORT=8085 \
    DIST_DIR=/app/dist \
    GAMEFILES_DIR=/data/gamefiles \
    MANIFEST_FILE=/data/gamefiles/manifest.json \
    STATS_DB=/data/stats/stats.db
EXPOSE 8085
# uid 1000, the VPS's own user, so the mounted folders are writable here and readable
# over SSH.
USER node
# The exec form: Node is PID 1 and receives SIGTERM. `node:sqlite` still warns that it is
# experimental, once, at start-up.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.ts"]
