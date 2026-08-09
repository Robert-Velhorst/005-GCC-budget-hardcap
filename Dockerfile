FROM node:22.18.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY web ./web
RUN npm run build:web

FROM node:22.18.0-bookworm-slim AS production-dependencies

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    CONTROL_HOST=0.0.0.0 \
    CONTROL_PORT=8787 \
    LOCAL_DATABASE_PATH=/data/budget-hardcap.db
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY index.js ./
COPY src ./src
COPY --from=build /app/web/dist ./web/dist
RUN mkdir /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "src/control/main.js"]
