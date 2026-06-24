import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import { startServer } from "./server";
import { stopAllPreviews } from "./routes/preview";
import { setupAutoUpdater } from "./updater";
import { maybeIndexNucleusOnStartup } from "./nucleus/startup";

const isDev = !app.isPackaged;

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]!);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  const userData = app.getPath("userData");

  process.env.AUTOCODE_DB_PATH ??= path.join(userData, "autocode.db");
  process.env.AUTOCODE_LOG_DIR ??= path.join(userData, "logs");
  // El índice RAG (Nucleus) y su modelo de embeddings viven en C:\ProgramData\AutoCode (ver nucleus/paths).
  process.env.API_PORT ??= "4317";
  process.env.API_HOST ??= "127.0.0.1";

  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox("AutoCode", `Error al arrancar el servidor: ${(e as Error).message}`);
    app.quit();
    return;
  }

  const win = await createWindow();

  // Auto-actualización: comprueba GitHub Releases, descarga la versión nueva y la instala (con aviso).
  setupAutoUpdater(win);

  // Indexado RAG con Nucleus: si su BBDD (C:\ProgramData\AutoCode) está vacía, indexa en diferido todo
  // el contenido de los desarrollos. Va en un worker → no congela la UI. Se retrasa para no competir con
  // el arranque (servidor + ventana). Best-effort: si falla, no afecta al resto de la app.
  setTimeout(() => {
    maybeIndexNucleusOnStartup().catch((e) =>
      console.warn("[nucleus] indexado de arranque falló:", e),
    );
  }, 5000);

  ipcMain.handle("autocode:select-folder", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Cerrar AutoCode mata sus procesos hijos: los servidores de PREVIEW (node dist/server.js) y Qdrant. Si
// no, en Windows los hijos no mueren con el padre → se quedan HUÉRFANOS y se acumulan entre reinicios
// (varios servidores a la vez, puertos distintos, "no entro porque estoy en la pestaña equivocada").
app.on("before-quit", () => {
  stopAllPreviews();
});

app.on("window-all-closed", () => {
  stopAllPreviews();
  if (process.platform !== "darwin") app.quit();
});

// En desarrollo (`npm run dev`), electron-vite reinicia el proceso main MATÁNDOLO con una señal, y
// `before-quit` puede no llegar a dispararse → previews huérfanos en cada reinicio. Capturamos la señal
// para matarlos antes de salir. (taskkill se lanza como proceso aparte, así que sigue aunque salgamos ya.)
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    try { stopAllPreviews(); } catch { /* salir igualmente */ }
    process.exit(0);
  });
}
