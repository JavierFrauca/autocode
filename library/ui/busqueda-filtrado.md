# Búsqueda y filtrado de listados

**Categoría:** ui | **Cuándo usar:** listados con suficientes registros como para que el usuario quiera
buscar/filtrar. Dos enfoques según el tamaño:

- **Pocos registros (cientos)** → **cliente**: trae todo y filtra/ordena/pagina en el navegador. Lo más
  simple. Usa `library/ui/vue-tabla-lista.md` (ya trae búsqueda + orden + paginación).
- **Muchos (miles+)** → **servidor**: la API recibe `?q=&...&pagina=&limite=` y devuelve `{ total, items }`.
  El front manda los filtros y pinta la página. Patrón completo (composable + barra + backend) en
  `templates/web/busqueda-filtrado.md`. El visor de accesos del área admin ya es un ejemplo de filtrado
  en servidor.

## Reglas

```ts
// Debounce de la búsqueda por texto (no consultar en cada tecla)
let t: ReturnType<typeof setTimeout>;
function alEscribir(fn: () => void) { clearTimeout(t); t = setTimeout(fn, 300); }
```

- **Debounce** la búsqueda por texto (~300 ms) para no machacar el servidor.
- **Conserva los filtros en la URL** (query params) → recargar/compartir mantiene el filtro.
- **Server-side**: valida y limita `limite` (techo, p.ej. 100) y construye el WHERE con parámetros (nunca
  concatenando valores) — como en `library/persistencia/paginacion.md`.
- Botón "Limpiar filtros". Muestra el total y el estado vacío ("sin resultados para …").

Relacionado: tabla `library/ui/vue-tabla-lista.md`, paginación `library/persistencia/paginacion.md`,
plantilla `templates/web/busqueda-filtrado.md`.
