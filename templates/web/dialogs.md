# Plantilla: diálogos con estilo (alert/confirm/prompt) — web y escritorio

**tags:** ui, dialogos, alert, confirm, prompt, modal, vue, web, escritorio
**transversal:** true
**Cuándo usar:** SIEMPRE que la app necesite avisar, pedir confirmación o pedir un dato. NUNCA uses
`window.alert` / `window.confirm` / `window.prompt` nativos (feos, bloqueantes, rompen el aspecto pro).
Este módulo es agnóstico de framework (vale en cualquier app Vue/web y en el renderer de Electron): crea
un modal con estilo en el DOM y devuelve una Promesa, así que se usa igual que los nativos pero con `await`.

Crea `src/lib/dialogs.ts` (en escritorio el andamiaje dorado ya lo trae en `src/renderer/src/lib/dialogs.ts`):

```typescript
export type DialogVariant = "info" | "success" | "warning" | "danger";
export interface AlertOptions { title?: string; variant?: DialogVariant; confirmText?: string; }
export interface ConfirmOptions extends AlertOptions { cancelText?: string; }
export interface PromptOptions extends ConfirmOptions { placeholder?: string; defaultValue?: string; inputType?: "text" | "password"; }

const STYLE_ID = "adx-dialogs-style";
function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
.adx-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  background:rgba(15,23,42,.55);backdrop-filter:blur(3px);opacity:0;transition:opacity .14s ease;padding:20px}
.adx-overlay.adx-in{opacity:1}
.adx-card{width:100%;max-width:420px;border-radius:14px;overflow:hidden;
  background:var(--bg-surface,#fff);color:var(--text,#0f172a);
  border:1px solid var(--border,rgba(0,0,0,.08));box-shadow:0 24px 64px rgba(0,0,0,.35);
  transform:translateY(8px) scale(.98);transition:transform .16s cubic-bezier(.2,.9,.3,1)}
.adx-overlay.adx-in .adx-card{transform:none}
@media (prefers-color-scheme:dark){.adx-card{background:var(--bg-surface,#1e293b);color:var(--text,#e2e8f0);border-color:var(--border,rgba(255,255,255,.1))}}
.adx-body{padding:22px 22px 16px}
.adx-title{display:flex;align-items:center;gap:10px;font-size:15.5px;font-weight:700;margin:0 0 6px}
.adx-ico{width:22px;height:22px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff}
.adx-ico.info{background:var(--accent,#3b82f6)}.adx-ico.success{background:var(--green,#16a34a)}
.adx-ico.warning{background:var(--amber,#d97706)}.adx-ico.danger{background:var(--red,#dc2626)}
.adx-msg{font-size:14px;line-height:1.55;color:var(--text-muted,#475569);white-space:pre-wrap;word-break:break-word}
@media (prefers-color-scheme:dark){.adx-msg{color:var(--text-muted,#94a3b8)}}
.adx-input{width:100%;margin-top:14px;padding:10px 12px;font:inherit;font-size:14px;border-radius:9px;
  border:1px solid var(--border,#cbd5e1);background:var(--bg,#fff);color:inherit;outline:none}
.adx-input:focus{border-color:var(--accent,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#3b82f6) 22%,transparent)}
@media (prefers-color-scheme:dark){.adx-input{background:var(--bg,#0f172a);border-color:var(--border,#334155)}}
.adx-actions{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px 18px}
.adx-btn{font:inherit;font-size:13.5px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:filter .12s,background .12s}
.adx-btn.ghost{background:transparent;border-color:var(--border,#cbd5e1);color:var(--text,#0f172a)}
@media (prefers-color-scheme:dark){.adx-btn.ghost{color:var(--text,#e2e8f0);border-color:var(--border,#334155)}}
.adx-btn.ghost:hover{background:var(--bg-hover,rgba(0,0,0,.05))}
.adx-btn.primary{color:#fff}.adx-btn.primary:hover{filter:brightness(1.07)}
.adx-btn.primary.info{background:var(--accent,#3b82f6)}.adx-btn.primary.success{background:var(--green,#16a34a)}
.adx-btn.primary.warning{background:var(--amber,#d97706)}.adx-btn.primary.danger{background:var(--red,#dc2626)}`;
  document.head.appendChild(el);
}
const ICONS: Record<DialogVariant, string> = { info: "i", success: "✓", warning: "!", danger: "✕" };
interface InternalOpts { kind: "alert" | "confirm" | "prompt"; message: string; title?: string; variant: DialogVariant;
  confirmText: string; cancelText: string; withInput: boolean; placeholder?: string; defaultValue?: string; inputType: "text" | "password"; }
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function open(o: InternalOpts): Promise<unknown> {
  injectStyles();
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(o.kind === "confirm" ? false : o.kind === "prompt" ? null : undefined); return; }
    const prevFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.className = "adx-overlay"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
    const titleHtml = o.title ? `<div class="adx-title"><span class="adx-ico ${o.variant}">${ICONS[o.variant]}</span>${escapeHtml(o.title)}</div>` : "";
    const inputHtml = o.withInput ? `<input class="adx-input" type="${o.inputType}" placeholder="${escapeHtml(o.placeholder ?? "")}" />` : "";
    const cancelHtml = o.kind === "alert" ? "" : `<button class="adx-btn ghost" data-act="cancel">${escapeHtml(o.cancelText)}</button>`;
    overlay.innerHTML = `<div class="adx-card"><div class="adx-body">${titleHtml}<div class="adx-msg">${escapeHtml(o.message)}</div>${inputHtml}</div>` +
      `<div class="adx-actions">${cancelHtml}<button class="adx-btn primary ${o.variant}" data-act="ok">${escapeHtml(o.confirmText)}</button></div></div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("adx-in"));
    const input = overlay.querySelector<HTMLInputElement>(".adx-input");
    if (input && o.defaultValue != null) input.value = o.defaultValue;
    const okBtn = overlay.querySelector<HTMLButtonElement>('[data-act="ok"]')!;
    (input ?? okBtn).focus(); if (input) input.select();
    const cancelValue = o.kind === "confirm" ? false : o.kind === "prompt" ? null : undefined;
    function done(result: unknown): void {
      overlay.classList.remove("adx-in"); document.removeEventListener("keydown", onKey, true);
      setTimeout(() => { overlay.remove(); prevFocus?.focus?.(); }, 140); resolve(result);
    }
    function confirmResult(): void { o.kind === "confirm" ? done(true) : o.kind === "prompt" ? done(input?.value ?? "") : done(undefined); }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") { e.preventDefault(); done(cancelValue); }
      else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmResult(); }
    }
    overlay.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (act === "ok") confirmResult(); else if (act === "cancel") done(cancelValue);
      else if (e.target === overlay && o.kind !== "alert") done(cancelValue);
    });
    document.addEventListener("keydown", onKey, true);
  });
}
export function alert(message: string, opts: AlertOptions = {}): Promise<void> {
  return open({ kind: "alert", message, title: opts.title, variant: opts.variant ?? "info", confirmText: opts.confirmText ?? "Aceptar", cancelText: "", withInput: false, inputType: "text" }) as Promise<void>;
}
export function confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return open({ kind: "confirm", message, title: opts.title, variant: opts.variant ?? "warning", confirmText: opts.confirmText ?? "Aceptar", cancelText: opts.cancelText ?? "Cancelar", withInput: false, inputType: "text" }) as Promise<boolean>;
}
export function prompt(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return open({ kind: "prompt", message, title: opts.title, variant: opts.variant ?? "info", confirmText: opts.confirmText ?? "Aceptar", cancelText: opts.cancelText ?? "Cancelar", withInput: true, placeholder: opts.placeholder, defaultValue: opts.defaultValue, inputType: opts.inputType ?? "text" }) as Promise<string | null>;
}
export const dialogs = { alert, confirm, prompt };
export default dialogs;
```

## Uso
```typescript
import { dialogs } from "@/lib/dialogs";

await dialogs.alert("Fichero exportado correctamente.", { variant: "success", title: "Listo" });
if (await dialogs.confirm("¿Eliminar esta transferencia?", { variant: "danger", confirmText: "Eliminar" })) {
  // ...borrar
}
const nombre = await dialogs.prompt("Nombre del fichero a exportar", { defaultValue: "remesa.xml" });
if (nombre) { /* ...exportar */ }
```

## Reglas
- **Prohibido** `window.alert/confirm/prompt`: usa SIEMPRE `dialogs.*`.
- Variantes: `info` (azul), `success` (verde), `warning` (ámbar), `danger` (rojo) — colorea el icono y el botón principal.
- Respeta el tema de la app si define `--accent`, `--red`, `--green`, `--bg-surface`, `--text`… (con fallback propio claro/oscuro).
- `Esc` cancela, `Enter` confirma, click en el fondo cancela (salvo en `alert`).
