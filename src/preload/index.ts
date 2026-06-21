import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("autocode", {
  apiBase: "http://127.0.0.1:4317",
  selectFolder: () => ipcRenderer.invoke("autocode:select-folder"),
});
