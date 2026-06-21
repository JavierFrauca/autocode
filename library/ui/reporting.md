# Reporting: imprimir listados y fichas

**Categoría:** ui | **Cuándo usar:** guía para DECIDIR si una pantalla debe ser imprimible y cómo hacerlo.
La implementación (componente `ReportLayout`, ficha, botón "Imprimir") está en `templates/web/report-layout.md`.

Sirve para **escritorio Y web**: el mecanismo es el mismo — **`window.print()`** abre el diálogo del sistema
(impresora física o **"Guardar como PDF"**), sin dependencias. En Electron, `window.print()` del renderer
abre el diálogo nativo igual que en el navegador. NO uses pdfkit/puppeteer para esto (eso es para documentos
formales del backend, ver `library/integraciones/pdf-generacion.md`).

## ¿Está justificado hacer una pantalla imprimible? (criterio)

No por defecto. Añade impresión cuando:
- La app es de **gestión** y el usuario necesita **un papel**: un **listado** (tabla de registros, p.ej. "lista
  de clientes", "pedidos del mes") o una **ficha** (hoja de UN registro: datos de un cliente, un parte de
  trabajo, una orden).
- Hay algo que se archiva, se firma, se entrega en mano o se manda por correo en papel/PDF.
- **NO** lo añadas a utilidades de un solo paso, asistentes, o pantallas puramente interactivas.

## Dos formatos

- **Listado**: una tabla. La cabecera (`<thead>`) se repite en cada página y las filas no se parten (ya lo
  hace el CSS de impresión del tema). Añade totales al pie si aplica.
- **Ficha**: la hoja de un registro. Secciones con pares **etiqueta/valor**; cada sección no se parte entre
  páginas (`class="ficha-seccion"`). Necesita una **vista de detalle** del registro (ver el template).

## Cómo (reglas)

El CSS de impresión YA viene en el tema (`assets/tema.css`, bloque `@media print`): oculta el menú lateral,
la cabecera y todo lo marcado `.no-print`, pone fondo blanco/texto negro y configura A4. Tú solo:

1. Marca con **`class="no-print"`** lo que NO debe salir en papel (botones, filtros, paginación, acciones).
2. Marca con **`class="solo-print"`** lo que solo debe salir al imprimir (p.ej. la cabecera del informe con
   título y fecha) — está oculto en pantalla.
3. Envuelve el contenido imprimible en **`ReportLayout`** (cabecera de informe + slot) y pon un botón
   **"Imprimir"** (`useImprimir()` → `window.print()`).
4. Para fichas, agrupa en `<section class="ficha-seccion">` para que no se corten entre páginas.

```css
/* Si necesitas un salto de página manual antes de un bloque */
.salto-pagina { break-before: page; }
```

## Limitaciones honestas

- **Numeración "Página X de Y"** en CSS puro NO es fiable en Chromium (no soporta contadores en márgenes de
  `@page`). Deja que el diálogo del navegador añada fecha/página en su cabecera/pie (opción estándar del
  diálogo), o no numeres. No inviertas en hacks frágiles.
- Lo que ves al imprimir = el HTML real; cuida que la tabla no sea más ancha que A4 (evita demasiadas columnas;
  si son muchas, una ficha por registro suele leerse mejor que una tabla enorme).

Relacionado: tema `library/ui/tema-tokens.md`, shell `library/ui/app-shell-sidebar.md`, tabla
`library/ui/vue-tabla-lista.md`, plantilla `templates/web/report-layout.md`.
