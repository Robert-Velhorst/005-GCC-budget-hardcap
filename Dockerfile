FROM node:26.12.0-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS build
ARG NPM_VERSION=12.2.1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global "npm@${NPM_VERSION}"
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY web ./web
RUN npm run build:web

FROM node:26.12.0-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS production-dependencies
ARG NPM_VERSION=12.2.1

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global "npm@${NPM_VERSION}"
COPY deploy/control/package.json deploy/control/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:26.12.0-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS runtime
ARG NPM_VERSION=12.2.1

ENV NODE_ENV=production \
    CONTROL_HOST=0.0.0.0 \
    CONTROL_PORT=8787 \
    LOCAL_DATABASE_PATH=/data/budget-hardcap.db
WORKDIR /app

COPY deploy/control/package.json ./package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY index.js ./
COPY src ./src
COPY --from=build /app/web/dist ./web/dist
RUN npm install --global "npm@${NPM_VERSION}"
RUN mkdir /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "src/control/main.js"]
