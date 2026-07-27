# The client as a container of static files behind Caddy
# (docs/adr/0043-railway-hosts-the-deployment.md).
#
# Vite substitutes VITE_API_BASE_URL at build time, so an image belongs to exactly one
# environment. That is why the build fails when the variable is missing rather than
# shipping a client that quietly talks to localhost.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

ARG VITE_API_BASE_URL
ARG VITE_APP_ENV=production
RUN test -n "${VITE_API_BASE_URL}" || (echo "VITE_API_BASE_URL is required at build time: the client cannot find the server without it" && exit 1)

COPY . .
RUN pnpm install --frozen-lockfile --filter "@gobblet/web..."
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_APP_ENV=${VITE_APP_ENV}
RUN pnpm --filter "@gobblet/web..." run build

FROM caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
