FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/src ./src
COPY --chown=node:node backend/certs ./certs
COPY --chown=node:node kit /app/kit
COPY --from=frontend --chown=node:node /build/frontend/dist /app/frontend/dist
COPY --chown=node:node deploy/start.sh /app/start.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "/app/start.sh"]
