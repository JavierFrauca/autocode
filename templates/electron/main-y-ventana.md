# Template: proceso principal (src/main/index.ts)

**tags:** electron, main, BrowserWindow, ventana, ciclo-vida
**transversal:** true
**Cuándo usar:** entrada del proceso principal de toda app Electron. Crea la ventana, carga el renderer y registra el IPC.

`src/main/index.ts`:
```typescript
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpc } from "./adapters/ipc/index.js";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  // En desarrollo electron-vite sirve el renderer y pone ELECTRON_RENDERER_URL.
  // En producción se carga el HTML compilado.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

## Notas
- `__dirname` funciona porque el main se compila a **CommonJS** (el package.json NO lleva `"type": "module"`).
- `show: false` + `ready-to-show` → la ventana aparece sin parpadeo blanco.
- `registerIpc()` ANTES de crear la ventana → los handlers ya están listos cuando el renderer llama.
- `sandbox: false` permite que el preload use `require`/módulos de Node (necesario para el contextBridge típico).
