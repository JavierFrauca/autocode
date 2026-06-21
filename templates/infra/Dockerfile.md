# Template: Dockerfile Node.js + Fastify (multi-stage)

**tags:** docker, node, fastify, producción
**transversal:** true

```dockerfile
# ── Build ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production ─────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```
