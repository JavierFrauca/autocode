import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { log } from "./log";

const { autoUpdater } = electronUpdater;

/**
 * Auto-actualización: la app comprueba en GitHub Releases (config `publish` de electron-builder) si hay
 * una versión más nueva, la descarga y la instala. El usuario no toca nada técnico: ve un aviso y pulsa
 * "Reiniciar e instalar". El manifiesto que se lee es el `latest.yml` que publica el workflow de release.
 *
 * Flujo: comprobar → (si hay nueva) descargar sola → avisar al renderer → al pulsar instalar, reinicia
 * con la versión nueva. Si no se reinicia, se instala al cerrar la app (autoInstallOnAppQuit).
 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "progress"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

let mainWindow: BrowserWindow | null = null;
let lastStatus: UpdateStatus = { state: "idle" };

function emit(status: UpdateStatus): void {
  lastStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("autocode:update:status", status);
  }
}

export function setupAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;

  // IPC siempre disponible (el renderer no tiene por qué saber si está empaquetada o no).
  ipcMain.handle("autocode:update:status", async () => lastStatus);

  // En desarrollo (`npm run dev`) no hay instalación ni `latest.yml`: electron-updater no aplica.
  if (!app.isPackaged) {
    ipcMain.handle("autocode:update:check", async () => {
      const s: UpdateStatus = { state: "not-available" };
      emit(s);
      return s;
    });
    ipcMain.handle("autocode:update:install", async () => false);
    log.info("updater", "modo desarrollo: auto-actualización desactivada");
    return;
  }

  autoUpdater.autoDownload = true; // descarga sola al encontrar versión nueva
  autoUpdater.autoInstallOnAppQuit = true; // si no se reinicia, instala al cerrar
  autoUpdater.logger = {
    info: (m: unknown) => log.info("updater", String(m)),
    warn: (m: unknown) => log.warn("updater", String(m)),
    error: (m: unknown) => log.error("updater", String(m)),
    debug: () => {},
  } as never;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) => emit({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => emit({ state: "not-available" }));
  autoUpdater.on("download-progress", (p) => emit({ state: "progress", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => emit({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => {
    log.warn("updater", "error de actualización", { err });
    emit({ state: "error", message: err?.message ?? String(err) });
  });

  // Comprobar bajo demanda (botón de la UI).
  ipcMain.handle("autocode:update:check", async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      emit({ state: "error", message: (e as Error).message });
    }
    return lastStatus;
  });

  // Instalar la versión ya descargada: cierra la app y arranca la nueva. `before-quit` (index.ts) ya
  // mata los procesos hijo (previews, Qdrant) antes de salir.
  ipcMain.handle("autocode:update:install", async () => {
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });

  // Comprobación automática: a los 8 s de arrancar y cada 6 h.
  const check = () =>
    autoUpdater.checkForUpdates().catch((e) => log.warn("updater", "fallo al comprobar", { err: e }));
  setTimeout(check, 8000);
  setInterval(check, 6 * 60 * 60 * 1000);
}
