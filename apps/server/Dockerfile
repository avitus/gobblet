# The server as a container, so the host stays replaceable
# (docs/adr/0043-railway-hosts-the-deployment.md). The build context is the repository
# root: this is a workspace, and the server imports packages that are built here.
#
# apps/server/test/container.test.ts keeps the copies below in step with the server's
# workspace dependencies, so adding one cannot silently produce an image that starts
# and then cannot find it.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY . .
# Only the server and what it depends on, rather than every package in the workspace.
RUN pnpm install --frozen-lockfile --filter "@gobblet/server..."
RUN pnpm --filter "@gobblet/server..." run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /repo

# Every copy hands ownership to the user this image runs as. COPY keeps the file modes of
# the build context and makes root the owner, so a manifest that happens to be 0600 on the
# machine that built the context is unreadable to that user, and Node reports an unreadable
# package.json as the package not existing at all.
#
# The manifests and the lockfile first, so a code change does not reinstall anything.
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY --chown=node:node apps/server/package.json apps/server/
COPY --chown=node:node packages/auth/package.json packages/auth/
COPY --chown=node:node packages/config/package.json packages/config/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node packages/game-core/package.json packages/game-core/
COPY --chown=node:node packages/protocol/package.json packages/protocol/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@gobblet/server..."

COPY --from=build --chown=node:node /repo/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /repo/packages/auth/dist packages/auth/dist
COPY --from=build --chown=node:node /repo/packages/config/dist packages/config/dist
COPY --from=build --chown=node:node /repo/packages/db/dist packages/db/dist
COPY --from=build --chown=node:node /repo/packages/game-core/dist packages/game-core/dist
COPY --from=build --chown=node:node /repo/packages/protocol/dist packages/protocol/dist

# Nothing here needs to be root.
USER node

# node is the process, not pnpm: a package manager as PID 1 swallows SIGTERM, and the
# drain of docs/operations.md section 8 would never run.
CMD ["node", "apps/server/dist/main.js"]
