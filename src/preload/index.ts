import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("autocode", {
  apiBase: "http://127.0.0.1:4317",
  selectFolder: () => ipcRenderer.invoke("autocode:select-folder"),

  // Auto-actualización: el renderer puede comprobar/instalar y suscribirse al estado.
  update: {
    check: () => ipcRenderer.invoke("autocode:update:check"),
    install: () => ipcRenderer.invoke("autocode:update:install"),
    getStatus: () => ipcRenderer.invoke("autocode:update:status"),
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: unknown, status: unknown) => cb(status);
      ipcRenderer.on("autocode:update:status", handler);
      return () => ipcRenderer.removeListener("autocode:update:status", handler);
    },
  },
});
