# Template: docker-compose.yml con PostgreSQL

**tags:** docker-compose, postgres, producción
**transversal:** true

```yaml
version: "3.9"

services:
  api:
    build: .
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      NODE_ENV: production
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-miapp}
      POSTGRES_USER: ${POSTGRES_USER:-admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-admin}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

## .env.example
```bash
API_PORT=3000
POSTGRES_DB=miapp
POSTGRES_USER=admin
POSTGRES_PASSWORD=cambia_esto_en_produccion
JWT_SECRET=secreto_largo_y_aleatorio_minimo_32_caracteres
```
