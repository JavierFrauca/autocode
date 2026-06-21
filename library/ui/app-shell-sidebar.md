# Cáscara de aplicación (app shell) con menú lateral

**Categoría:** ui | **Cuándo usar:** TODA app con interfaz (web y escritorio). Es la "pantalla principal":
menú lateral colapsable + cabecera + área de contenido. **Ya viene montada en el andamiaje dorado** — esto
documenta cómo está hecha y cómo AÑADIR pantallas sin romperla.

## Qué trae el andamiaje (NO lo recrees)

- **Web** (`templates/server-app/web/src`): `App.vue` (shell con dos layouts: público para `/login`, privado
  con menú lateral), `components/AppSidebar.vue` (menú + usuario + cerrar sesión), `router.ts` (rutas + guard
  de sesión), `stores/ui.ts` (colapsar), `stores/auth.ts` (sesión), `views/LoginView.vue`, `views/InicioView.vue`.
- **Escritorio** (`templates/electron-app/src/renderer/src`): igual pero SIN login (apps locales): `App.vue`,
  `components/AppSidebar.vue`, `router.ts` (hash history), `stores/ui.ts`, `views/InicioView.vue`.
- Colores y primitivas: `assets/tema.css` (ver `library/ui/tema-tokens.md`). Web = claro; escritorio = oscuro.

## Cómo añadir una pantalla (el patrón)

1. Crea la vista en `views/MiPantallaView.vue` (usa las primitivas `.card/.btn/.input/.field`; parte de la
   maqueta de Documentos si existe — `leer_maqueta`).
2. Regístrala como ruta en `router.ts`:
   ```ts
   { path: "/clientes", name: "clientes", component: ClientesView, meta: { titulo: "Clientes" } }
   ```
   (en web añade `meta: { publica: true }` SOLO si debe verse sin sesión; por defecto exige login).
3. Añádela al menú en `components/AppSidebar.vue` (un objeto a `enlaces`, con su icono SVG). Puedes filtrar
   por rol: `v-if="auth.esAdmin"` o construyendo `enlaces` según `auth.usuario?.rol`.

## Reglas

- **No sustituyas `App.vue`** (el shell) ni el router ni el menú: son infraestructura permanente. Reemplaza la
  vista placeholder `views/InicioView.vue` por la primera pantalla real; el resto, vistas nuevas.
- La primera pantalla del menú suele ser un panel/resumen (ver `library/ui/dashboards.md` si procede).
- Menú lateral siempre; colapsable para pantallas estrechas. El ítem activo se marca solo (`router-link-active`).

Relacionado: tema `library/ui/tema-tokens.md`, login `library/auth/login-system.md`, router `library/ui/vue-router.md`.
