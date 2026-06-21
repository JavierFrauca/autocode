# Docker Compose con PostgreSQL + Node.js

**Categoría:** despliegue | **Cuándo usar:** Stack completo local o servidor propio

## docker-compose.yml completo

```yaml
version: "3.9"

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://admin:secret@postgres:5432/miapp
      NODE_ENV: production
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: miapp
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d miapp"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./dist/web:/usr/share/nginx/html:ro
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
```

## .env para secrets

```bash
# .env.prod (nunca en git)
JWT_SECRET=cambiame-por-algo-largo-y-aleatorio
```

## Despliegue

```bash
# Primera vez
docker-compose up -d

# Actualizar después de build
docker-compose pull && docker-compose up -d

# Ver logs
docker-compose logs -f api
```
