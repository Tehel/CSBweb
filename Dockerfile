# The deployed game (`doc/DEPLOYMENT.md`): `server/` on Node 24, over the built page.
# The game files and the statistics are mounted, never in the image:
#
#   /data/gamefiles   the data sets, and the folders players' sets are uploaded to, written here
#   /data/stats       stats.db: the statistics, and the data sets, written by hand or published;
#                     backups/: its snapshots and the uploaded folders' copies
#   /data/files       the files shared by link, under `files/`, read-only
#
#   docker build --build-arg CSBWEB_BUILD=$(git rev-parse --short HEAD) -t csbweb .
#
# CSBWEB_BUILD names the build in the page's events: the build stage has no `.git`.
# CSBWEB_PROBE=1 builds the page with the probes' handle, for the golden frames
# (`tools/check-frames.sh --url`), and is never deployed.

# One Node, the project's (`.nvmrc`, `package.json`'s `engines` and `@types/node`): 24, its
# image pinned by the digest of its multi-platform index, so that a rebuild takes the same
# bytes. Moving it on (`doc/DEPLOYMENT.md`) moves those three with it.
ARG NODE_IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG CSBWEB_BUILD=unknown
ARG CSBWEB_PROBE=
RUN CSBWEB_BUILD="$CSBWEB_BUILD" CSBWEB_PROBE="$CSBWEB_PROBE" npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
# No node_modules: the server has no dependency. `package.json` is there for its
# `"type": "module"`, and `DataSets.ts` is the page's, whose routes and limits the server
# imports from `../src/data/`. `dist/server/` is the page's check of a player's set,
# bundled for Node, which the server loads at start-up.
COPY package.json ./
COPY server/ server/
COPY src/data/DataSets.ts src/data/DataSets.ts
COPY --from=build /app/dist/ dist/
ENV PORT=8085 \
    DIST_DIR=/app/dist \
    GAMEFILES_DIR=/data/gamefiles \
    FILES_DIR=/data/files \
    STATS_DB=/data/stats/stats.db
EXPOSE 8085
# uid 1000, the VPS's own user, so the mounted folders are writable here and readable
# over SSH.
USER node
# The exec form: Node is PID 1 and receives SIGTERM. `node:sqlite` still warns that it is
# experimental, once, at start-up.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.ts"]
