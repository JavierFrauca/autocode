# Template: preload + API tipada (src/preload/index.ts + index.d.ts)

**tags:** electron, preload, contextBridge, ipcRenderer, api, tipos
**transversal:** true
**Cuándo usar:** el puente seguro entre el renderer (Vue) y el proceso principal. Expone UNA función por caso de uso. El renderer las llama con `window.api.xxx(...)`.

`src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from "electron";

// UNA entrada por cada caso de uso (IPC). Tipado fuerte → el renderer sabe qué hay.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("app:ping"),

  // Ejemplos reales (descomenta y adapta a tu dominio):
  // abrirFichero: (ruta: string): Promise<FicheroDTO> => ipcRenderer.invoke("fichero:abrir", ruta),
  // guardarFichero: (datos: FicheroDTO): Promise<void> => ipcRenderer.invoke("fichero:guardar", datos),
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
```

`src/preload/index.d.ts` (para que el renderer conozca `window.api`):
```typescript
import type { Api } from "./index.js";

declare global {
  interface Window {
    api: Api;
  }
}
```

## Reglas
- **Cada caso de uso = una función en `api`** + un `ipcMain.handle` con el MISMO canal (p.ej. `"fichero:abrir"`).
- Tipa argumentos y retorno → el renderer y el compilador te avisan si no encaja (adiós a los `Property 'x' does not exist`).
- NO metas lógica aquí: el preload solo reenvía a `ipcRenderer.invoke`.
- El `index.d.ts` hace que `window.api.ping()` compile en el renderer (que tiene `dom` en su tsconfig).
