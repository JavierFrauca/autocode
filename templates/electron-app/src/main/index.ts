import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";

/**
 * Proceso principal. Crea la ventana y carga el renderer:
 *  - dev: desde el servidor de Vite (ELECTRON_RENDERER_URL).
 *  - prod: el html YA construido en out/renderer (electron-vite lo emite ahí con las rutas correctas).
 * Aquí NO hay lógica de negocio: solo ventana + registro de IPC (los adaptadores van en adapters/ipc).
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// Ejemplo de canal IPC (los adaptadores reales se registran aquí; ver src/main/adapters/ipc).
ipcMain.handle("app:ping", () => "pong");

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
