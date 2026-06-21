# Tema y sistema de diseño — tokens compartidos

**Categoría:** ui | **Cuándo usar:** TODA app con interfaz (web y escritorio). Es la fuente única del
esquema de color, tipografía, espaciado y radios. El shell (`app-shell-sidebar.md`), la pantalla de
login (`login-view.md`) y todas las pantallas del dominio consumen estos tokens — nunca colores sueltos.

## Principio

- **Cero colores hardcodeados en los componentes.** Cada componente usa `var(--…)`. Cambiar el tema =
  tocar un solo fichero (`assets/tema.css`).
- **Dos paletas por defecto**, alineadas con las maquetas (`prompts/mockup-system.md`) para que *lo que
  ves en la maqueta ≈ lo que sale*:
  - **Web** → claro (índigo sobre gris muy claro).
  - **Escritorio** → oscuro (slate con acento cian).
- **Modo claro/oscuro** opcional con `[data-theme="dark"]` en `<html>`; el valor por defecto lo fija la
  plataforma (web=claro, escritorio=oscuro).

## Tokens (contrato)

| Token | Significado |
|---|---|
| `--bg` | fondo de la ventana/página |
| `--surface` | tarjetas, barras, paneles |
| `--surface-2` | hover / segundo nivel |
| `--border` | bordes y separadores |
| `--text` | texto principal |
| `--text-muted` | texto secundario |
| `--accent` | color de marca / acción primaria |
| `--accent-contrast` | texto sobre `--accent` |
| `--danger` / `--ok` / `--warn` | estados |
| `--radius` / `--radius-sm` | redondeo |
| `--shadow` | sombra de elevación |
| `--sidebar-w` / `--sidebar-w-min` | ancho del menú lateral expandido/colapsado |
| `--space` | unidad de espaciado base (8px) |

## `assets/tema.css` — ESCRITORIO (oscuro, por defecto)

```css
:root {
  --bg: #0f172a;          --surface: #1e293b;     --surface-2: #243449;
  --border: #334155;      --text: #e2e8f0;        --text-muted: #94a3b8;
  --accent: #38bdf8;      --accent-contrast: #0f172a;
  --danger: #f87171;      --ok: #4ade80;          --warn: #fbbf24;
  --radius: 12px;         --radius-sm: 8px;       --space: 8px;
  --shadow: 0 8px 24px rgba(0,0,0,.35);
  --sidebar-w: 240px;     --sidebar-w-min: 64px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

## `assets/tema.css` — WEB (claro, por defecto)

```css
:root {
  --bg: #f5f7fb;          --surface: #ffffff;     --surface-2: #f1f5f9;
  --border: #e7ecf3;      --text: #0f172a;        --text-muted: #64748b;
  --accent: #4f46e5;      --accent-contrast: #ffffff;
  --danger: #dc2626;      --ok: #16a34a;          --warn: #d97706;
  --radius: 12px;         --radius-sm: 8px;       --space: 8px;
  --shadow: 0 8px 24px rgba(16,24,40,.06);
  --sidebar-w: 240px;     --sidebar-w-min: 64px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
/* Modo oscuro opcional para web: <html data-theme="dark"> */
[data-theme="dark"] {
  --bg: #0f172a;  --surface: #1e293b;  --surface-2: #243449;
  --border: #334155;  --text: #e2e8f0;  --text-muted: #94a3b8;
  --shadow: 0 8px 24px rgba(0,0,0,.35);
}
```

## Base + primitivas (igual en ambas plataformas)

Va a continuación de los tokens en `assets/tema.css`. Da a TODA la app un aspecto coherente sin que cada
pantalla reinvente estilos.

```css
*, *::before, *::after { box-sizing: border-box; }
html, body, #app { height: 100%; }
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }

/* Tarjeta */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: calc(var(--space)*2.5); box-shadow: var(--shadow); }

/* Botón */
.btn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
  padding: 10px 16px; border-radius: var(--radius-sm); cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn--primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
.btn--primary:hover { filter: brightness(1.07); }
.btn--danger { background: var(--danger); color: #fff; border-color: var(--danger); }

/* Campo de formulario */
.field { display: flex; flex-direction: column; gap: 6px; }
.field > label { font-size: 13px; color: var(--text-muted); font-weight: 600; }
.input, .select, .textarea { font: inherit; color: var(--text); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; outline: none; }
.input:focus, .select:focus, .textarea:focus {
  border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }

/* Píldora / etiqueta de estado */
.pill { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px;
  background: var(--surface-2); color: var(--text-muted); }
.muted { color: var(--text-muted); }
```

## Reglas para el builder

- Importa `./assets/tema.css` UNA vez en el `main.ts` del renderer/front. No definas colores en cada `.vue`.
- Usa las primitivas (`.card`, `.btn`, `.input`, `.field`, `.pill`) en las pantallas; añade estilos
  específicos solo con `var(--…)`, nunca con hex sueltos.
- La paleta la elige la plataforma (web=claro, escritorio=oscuro); no la cambies salvo que el plan lo pida.
- `tema.css` incluye un bloque `@media print` (impresión de listados/fichas): oculta la cáscara y fuerza
  A4 blanco/negro. Marca `.no-print` lo que no debe imprimirse y `.solo-print` lo que solo aparece en papel.
  Ver `library/ui/reporting.md`.

Relacionado: shell `app-shell-sidebar.md`, login `login-system.md`/`login-view.md`, reporting
`library/ui/reporting.md`, maquetas (`prompts/mockup-system.md`), dashboards `library/ui/dashboards.md`.
