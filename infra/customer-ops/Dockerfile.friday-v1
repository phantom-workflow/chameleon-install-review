FROM node:20-alpine

ARG APP_GIT_SHA=unknown
ARG APP_BUILD_ID=unknown
ARG APP_BUILD_TIMESTAMP=unknown

ENV NODE_ENV=production \
    APP_ENV=production \
    APP_GIT_SHA=$APP_GIT_SHA \
    APP_BUILD_ID=$APP_BUILD_ID \
    APP_BUILD_TIMESTAMP=$APP_BUILD_TIMESTAMP

WORKDIR /app
COPY --chown=node:node apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node apps/api/src ./src
COPY --chown=node:node apps/api/migrations ./migrations

USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:8080/api/v2/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server-v2.js"]
