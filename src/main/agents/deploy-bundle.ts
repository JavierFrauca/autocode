import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Genera el PAQUETE DE DESPLIEGUE de una app cliente/servidor: el usuario (no técnico) se lo pasa a su
 * sysadmin, que hace `docker compose up -d` y la app queda en marcha. Containeriza la MISMA app (Fastify
 * + SQLite con volumen persistente) — sin Postgres por defecto (documentado como upgrade). Devuelve un
 * .zip con el código + los ficheros de despliegue (sin node_modules/dist: Docker construye desde fuente).
 */

const DOCKERFILE = `# Imagen de la app (build + runtime). El sysadmin solo hace 'docker compose up -d'.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
ENV PORT=3000
ENV DB_FILE=/data/app.sqlite
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
`;

const COMPOSE = `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "\${PORT:-3000}:3000"
    environment:
      - DB_FILE=/data/app.sqlite
    volumes:
      - appdata:/data   # la base de datos vive aquí (persiste entre reinicios)

volumes:
  appdata:
`;

const DOCKERIGNORE = `node_modules
dist
out
release
.git
*.sqlite
*.sqlite-*
.preview.sqlite
`;

const ENV_EXAMPLE = `# Copia este fichero a .env y ajusta lo que necesites.
# Puerto en el que se publica la app (en el host).
PORT=3000
`;

function despliegueMd(projectName: string): string {
  return `# Despliegue de ${projectName}

Este paquete contiene la aplicación y todo lo necesario para ponerla en marcha en un servidor con **Docker**. Pensado para que tu equipo de sistemas (IT/sysadmin) la despliegue sin tener que tocar el código.

## Requisitos
- Docker y Docker Compose en el servidor.

## Puesta en marcha (1 comando)
\`\`\`bash
cp .env.example .env      # ajusta el PORT si quieres
docker compose up -d --build
\`\`\`
La app queda escuchando en \`http://SERVIDOR:PORT\` (3000 por defecto). Para ver los logs: \`docker compose logs -f\`. Para pararla: \`docker compose down\` (los datos se conservan en el volumen \`appdata\`).

## Dónde viven los datos
La base de datos (SQLite) está en el **volumen Docker \`appdata\`** (montado en \`/data\`), así que **persiste** aunque reinicies o actualices el contenedor.

## Copias de seguridad
\`\`\`bash
docker run --rm -v <proyecto>_appdata:/data -v "$PWD":/backup busybox \\
  cp /data/app.sqlite /backup/backup-$(date +%F).sqlite
\`\`\`

## Actualizar a una versión nueva
Sustituye el código por el nuevo paquete y repite \`docker compose up -d --build\`. El volumen de datos se mantiene.

## ¿Mucha concurrencia? → Postgres (opcional, futuro)
Esta entrega usa **SQLite** (un fichero), que es suficiente para uso interno y cargas moderadas. Si necesitas alta concurrencia de escritura o varias réplicas, migra la capa de datos a **PostgreSQL** (mismo modelo de datos; añade un servicio \`postgres\` al \`docker-compose.yml\` y usa \`DATABASE_URL\`). No viene activado por defecto para mantener el despliegue simple y sin segunda pieza.
`;
}

/** ¿La ruta (relativa, separada por /) debe excluirse del zip? */
function excluded(rel: string): boolean {
  const f = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (/(^|\/)(node_modules|dist|out|release|\.git)(\/|$)/.test(f)) return true;
  if (/\.sqlite(-.*)?$/.test(f)) return true;
  return false;
}

/** Añade un directorio al zip recursivamente, respetando las exclusiones. */
async function addDir(zip: AdmZip, absDir: string, rel: string): Promise<void> {
  let entries;
  try { entries = await fs.readdir(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (excluded(childRel)) continue;
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) await addDir(zip, abs, childRel);
    else {
      try { zip.addFile(childRel, await fs.readFile(abs)); } catch { /* fichero ilegible: omitir */ }
    }
  }
}

export interface DeployBundleResult {
  bundlePath: string;
  files: string[]; // ficheros de despliegue añadidos a la app
}

export async function buildDeployBundle(ws: string, rootPath: string, projectName: string): Promise<DeployBundleResult> {
  // 1) Escribir los ficheros de despliegue dentro de la app (quedan en el repo de la app, y en el zip).
  const written: Array<[string, string]> = [
    ["Dockerfile", DOCKERFILE],
    ["docker-compose.yml", COMPOSE],
    [".dockerignore", DOCKERIGNORE],
    [".env.example", ENV_EXAMPLE],
    ["DESPLIEGUE.md", despliegueMd(projectName)],
  ];
  for (const [name, content] of written) {
    await fs.writeFile(path.join(ws, name), content, "utf-8");
  }

  // 2) Empaquetar el código + los ficheros de despliegue (sin node_modules/dist: Docker construye).
  const zip = new AdmZip();
  await addDir(zip, ws, "");

  const safeName = (projectName || "app").replace(/[^\w.-]+/g, "-").toLowerCase().slice(0, 60) || "app";
  const outDir = path.join(rootPath, "dist-despliegue");
  await fs.mkdir(outDir, { recursive: true });
  const bundlePath = path.join(outDir, `${safeName}-despliegue.zip`);
  zip.writeZip(bundlePath);

  return { bundlePath, files: written.map(([n]) => n) };
}
