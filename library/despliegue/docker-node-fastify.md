# Docker para aplicación Node.js + Fastify

**Categoría:** despliegue | **Cuándo usar:** Contenedorizar la API para producción

## Dockerfile multi-stage (optimizado)

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

## .dockerignore

```
node_modules
dist
.env
*.log
.git
```

## Variables de entorno en producción

```dockerfile
# NO hardcodear secretos en el Dockerfile
# Pasarlos via docker-compose o secrets de Kubernetes
ENV PORT=3000
ENV NODE_ENV=production
# DATABASE_URL se pasa en runtime
```

## Comandos útiles

```bash
# Build
docker build -t miapp:latest .

# Run con env file
docker run -p 3000:3000 --env-file .env.prod miapp:latest

# Ver logs
docker logs -f <container-id>
```
