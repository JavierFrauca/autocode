import { contextBridge, ipcRenderer } from "electron";
import type { Item } from "../main/repos/items.repo";

/**
 * Puente seguro renderer ↔ main (contextIsolation). El renderer SOLO ve `window.api`, nunca Node ni
 * ipcRenderer directos. Añade aquí un método por cada caso de uso (que el main resuelve por IPC).
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("app:ping"),
  // EJEMPLO sobre el repositorio de items (el agente lo reemplaza por el dominio real, un grupo de
  // métodos por entidad — mismo patrón: invoke a un canal que el main resuelve contra su repositorio).
  items: {
    listar: (): Promise<Item[]> => ipcRenderer.invoke("items:listar"),
    crear: (nombre: string): Promise<Item> => ipcRenderer.invoke("items:crear", nombre),
    borrar: (id: number): Promise<void> => ipcRenderer.invoke("items:borrar", id),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
