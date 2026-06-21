# Preferencias de usuario

**Categoría:** ui | **Cuándo usar:** ajustes personales que persisten entre sesiones. **Ya viene en el
andamiaje** (web y escritorio) la v1: **tema claro/oscuro** con un conmutador en la cabecera, persistido en
`localStorage`. NO lo recrees; amplíalo si el dominio necesita más preferencias (densidad, idioma…).

## Qué trae

- `stores/preferencias.ts` (Pinia): `tema` ("claro"|"oscuro"), `alternar()`, `set()`, `aplicar()`. Persiste en
  `localStorage` y aplica `data-theme` en `<html>`. Por defecto: web=claro, escritorio=oscuro.
- Botón sol/luna en la cabecera (`App.vue`).
- Tokens de ambos modos en `assets/tema.css` (`:root` = default de la plataforma; `[data-theme="dark"]` y
  `[data-theme="light"]`). Ver `library/ui/tema-tokens.md`.

## Añadir una preferencia nueva

```ts
// en stores/preferencias.ts, junto a `tema`:
const densidad = ref<"comoda" | "compacta">((localStorage.getItem("pref:densidad") as never) ?? "comoda");
function setDensidad(v: "comoda" | "compacta") { densidad.value = v; localStorage.setItem("pref:densidad", v); }
// expón densidad/setDensidad en el return y aplícala donde toque (p.ej. un data-attr en <html>).
```

## Reglas

- `localStorage` es suficiente para preferencias de UI (es por dispositivo). Si deben seguir al usuario entre
  equipos, guárdalas también por usuario en la BD (tabla `preferencias` o columna JSON en `usuarios`) y
  sincronízalas al iniciar sesión.
- No metas datos sensibles en `localStorage`. La sesión/seguridad NO va aquí (eso es cookie httpOnly).

Relacionado: tema `library/ui/tema-tokens.md`, shell `library/ui/app-shell-sidebar.md`.
