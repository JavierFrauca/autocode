import { contextBridge, ipcRenderer } from "electron";

/**
 * Puente seguro renderer ↔ main (contextIsolation). El renderer SOLO ve `window.api`, nunca Node ni
 * ipcRenderer directos. Añade aquí un método por cada caso de uso (que el main resuelve por IPC).
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("app:ping"),
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
