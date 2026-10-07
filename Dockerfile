FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY engine/package.json engine/package-lock.json ./engine/
RUN cd engine && npm ci

COPY engine ./engine
RUN cd engine && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/engine/node_modules ./engine/node_modules
COPY --from=build /app/engine/.output ./engine/.output
COPY --from=build /app/engine/agent ./engine/agent
COPY --from=build /app/engine/package.json ./engine/package.json
COPY --from=build /app/engine/tsconfig.json ./engine/tsconfig.json
COPY dist ./dist
COPY server.mjs start.mjs package.json ./

EXPOSE 8080
CMD ["node", "start.mjs"]
