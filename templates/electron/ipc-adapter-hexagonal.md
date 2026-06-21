# Template: adaptador de entrada IPC (src/main/adapters/ipc/index.ts)

**tags:** electron, ipc, ipcMain, adapter, hexagonal, application
**transversal:** true
**Cuándo usar:** el adaptador de ENTRADA en Electron. Es el equivalente a las rutas HTTP de un servidor Fastify, pero por IPC. Conecta el preload (`window.api.x`) con los handlers de `application/`.

`src/main/adapters/ipc/index.ts`:
```typescript
import { ipcMain } from "electron";
// import { AbrirFicheroHandler } from "../../application/commands/AbrirFichero.handler.js";
// import { SqliteFicheroRepository } from "../../infrastructure/db/SqliteFicheroRepository.js";

/**
 * Registra TODOS los canales IPC. Regla hexagonal: el handle SOLO traduce
 * (recibe args del renderer, llama al handler de application/, devuelve el resultado).
 * Cero lógica de negocio aquí — igual que una ruta Fastify no lleva lógica.
 */
export function registerIpc(): void {
  ipcMain.handle("app:ping", async () => "pong");

  // Ejemplo de caso de uso real (descomenta y adapta):
  // const ficheroRepo = new SqliteFicheroRepository();
  // const abrirFichero = new AbrirFicheroHandler(ficheroRepo);
  // ipcMain.handle("fichero:abrir", async (_event, ruta: string) => {
  //   const result = await abrirFichero.handle({ ruta });
  //   if (!result.ok) throw new Error(result.error.message);
  //   return result.value;
  // });
}
```

## Cómo crece (por cada caso de uso del plan)
1. **domain/**: entidad + puerto (interface del repo).
2. **application/**: `XxxCommand` + `XxxHandler` (constructor recibe los PUERTOS, no implementaciones).
3. **infrastructure/**: el repo concreto (better-sqlite3) que implementa el puerto.
4. **adapters/ipc/**: un `ipcMain.handle("dominio:accion", ...)` que construye el handler y lo invoca.
5. **preload**: una entrada `api.accion = () => ipcRenderer.invoke("dominio:accion", ...)`.
6. **renderer**: `await window.api.accion(...)`.

El **canal** (`"dominio:accion"`) debe ser IDÉNTICO en el `ipcMain.handle` y en el `ipcRenderer.invoke` del preload. Es el contrato.

## Mapeo con la guía de servidor
Donde la guía hexagonal de servidor dice *"ruta Fastify en adapters/http"*, en Electron es *"`ipcMain.handle` en adapters/ipc"*. Todo lo demás (domain, application, infrastructure, puertos, Result, inyección de dependencias) es **idéntico**.
