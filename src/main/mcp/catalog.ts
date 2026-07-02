/**
 * Biblioteca CERRADA de servidores MCP que pueden "vitaminar" el chat. A propósito NO hay forma de que
 * el usuario añada uno arbitrario: el público de AutoCode es gente NO técnica (ver chat-system.md) y no
 * tiene por qué saber juzgar si un MCP de un desconocido es de fiar. En su lugar, AutoCode cura esta
 * lista, explica ventajas/inconvenientes de cada una en su propia ficha, y la mantiene ella misma.
 *
 * IMPORTANTE — cómo se activa una entrada nueva: el conector del cliente MCP (`client.ts`) SOLO conecta
 * entradas con `estado: "disponible"`. Una entrada `pendiente_de_validar` (como la única que hay hoy)
 * es intencionadamente imposible de activar desde Ajustes hasta que alguien la valide de verdad
 * (repo activo, comando de instalación probado) y cambie su estado en este fichero — así el catálogo
 * nunca promete algo que no se ha comprobado.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { app as electronApp } from "electron";

export type McpEstado = "disponible" | "pendiente_de_validar" | "degradado" | "retirado";

export interface McpEnvField {
  /** Nombre de la variable de entorno que espera el proceso MCP, p.ej. "BRAVE_API_KEY". */
  clave: string;
  /** Etiqueta en lenguaje llano para el formulario de Ajustes, p.ej. "Clave de Brave Search". */
  etiqueta: string;
  ayuda?: string;
  secreto?: boolean;
}

export interface McpCatalogEntry {
  id: string;
  nombre: string;
  descripcion: string;
  ventajas: string[];
  inconvenientes: string[];
  estado: McpEstado;
  transport: "stdio";
  /** Comando/args por defecto (o de último recurso — ver `resolveCommand`). */
  command: string;
  args: string[];
  /**
   * Si la entrada va VENDIDA como dependencia real de AutoCode (node_modules), resuelve la ruta real en
   * el momento de conectar (dev vs empaquetado difieren) y sustituye a `command`/`args`. Así el usuario
   * NO necesita Node/npm/npx instalados — se lanza con el Node que Electron ya trae embebido.
   */
  resolveCommand?: () => { command: string; args: string[] };
  /** Config FIJA que decide AutoCode (no la rellena el usuario) — motor de búsqueda por defecto, modo, etc. */
  envFijo?: Record<string, string>;
  /** Variables que sí debe rellenar el usuario en Ajustes (una clave, normalmente). Vacío si no hace falta ninguna. */
  envRequerido?: McpEnvField[];
}

/**
 * `open-websearch` va VENDIDO como dependencia real de AutoCode (`package.json` → `node_modules`, versión
 * fijada) — no se descarga por red la primera vez que se activa. Se resuelve subiendo desde `__dirname`
 * (funciona en fuente, compilado o test) o, empaquetado, en `app.asar.unpacked` (ver `asarUnpack` en
 * `package.json` — un módulo dentro del asar no se puede lanzar como proceso hijo, el SO no sabe leerlo).
 * Si por lo que sea no se encuentra vendido, cae a `npx` como último recurso (necesita Node del sistema).
 */
function resolveOpenWebSearchCommand(): { command: string; args: string[] } {
  const rel = path.join("node_modules", "open-websearch", "build", "index.js");
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, rel);
    if (existsSync(candidate)) return { command: process.execPath, args: [candidate] };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (electronApp?.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", rel);
    if (existsSync(unpacked)) return { command: process.execPath, args: [unpacked] };
  }
  return { command: "npx", args: ["-y", "open-websearch@2.1.11"] };
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "busqueda-web",
    nombre: "Búsqueda web",
    descripcion:
      "Permite que el chat busque en internet cuando le pidas investigar algo (una norma, un formato de " +
      "fichero, cómo hace algo la competencia…) y te enseñe una lista de lo que ha encontrado para que " +
      "elijas qué adjuntar al proyecto. Usa DuckDuckGo/Bing (sin cuenta ni clave) — validado 2026-07: " +
      "paquete `open-websearch` (npm, Apache-2.0, ~1.5k estrellas, mantenimiento activo).",
    ventajas: [
      "Gratis y sin clave: no hay que dar de alta ninguna cuenta ni pagar nada.",
      "No necesitas tener Node ni nada instalado: viene YA integrado en AutoCode.",
      "El chat deja de depender de que tú le pases la URL exacta: puede proponerte varias.",
      "Lo que decidas adjuntar pasa por el mismo camino ya reforzado (detección de PDF/XSD/ZIP, límite de tamaño).",
      "Varios motores de respaldo: si uno falla, puede seguir funcionando con otro.",
    ],
    inconvenientes: [
      "No es una API oficial: consulta el buscador \"como lo haría una persona\", así que si el buscador " +
        "cambia su página puede dejar de funcionar hasta que el paquete se actualice — no hay garantía de servicio.",
      "Si se hacen muchas búsquedas seguidas en poco tiempo, el buscador puede bloquear temporalmente las peticiones.",
      "Como cualquier búsqueda web, puede devolver resultados desactualizados o de fuentes poco fiables — revisa antes de adjuntar.",
      "Es de uso personal según su propia licencia de uso — no pensado para volumen alto o uso comercial intensivo.",
    ],
    estado: "disponible",
    transport: "stdio",
    // command/args de aquí son el ÚLTIMO recurso (si resolveCommand no encuentra el paquete vendido);
    // en el camino normal, resolveCommand los sustituye por el Node de Electron + la ruta real.
    command: "npx",
    args: ["-y", "open-websearch@2.1.11"],
    resolveCommand: resolveOpenWebSearchCommand,
    envFijo: {
      MODE: "stdio",
      DEFAULT_SEARCH_ENGINE: "duckduckgo",
      // Sin "exa"/"brave": esos motores concretos piden su propia clave en este paquete; nos quedamos con
      // los que de verdad funcionan sin ninguna, que es la razón de ser de esta entrada.
      ALLOWED_SEARCH_ENGINES: "duckduckgo,bing",
    },
    envRequerido: [],
  },
];

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}
