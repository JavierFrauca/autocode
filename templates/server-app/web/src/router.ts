import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "./stores/auth";
import InicioView from "./views/InicioView.vue";
import LoginView from "./views/LoginView.vue";
import UsuariosView from "./views/admin/UsuariosView.vue";
import AccesosView from "./views/admin/AccesosView.vue";

/**
 * Router del front. Usa history limpio (el servidor reescribe a index.html, ver server.ts). El guard
 * exige sesión para todo lo que NO esté marcado `meta.publica`. La seguridad REAL la impone la API; el
 * guard es UX.
 *
 * MENÚ LATERAL AUTOMÁTICO: el sidebar (`AppSidebar.vue`) se DERIVA de estas rutas — toda ruta con
 * `meta.menu` aparece sola en el menú. Para añadir una pantalla del plan basta con registrarla aquí con
 * `meta.menu`; NO toques AppSidebar.vue. `meta.menu.icono` = atributo `d` de un <path> SVG (sin librerías);
 * `orden` ordena; `label` (opcional) es el texto del menú (por defecto usa `titulo`). Las pantallas de
 * DETALLE/secundarias (p.ej. `/clientes/:id`, "Nuevo …") van SIN `meta.menu` (no salen en el menú).
 */
export const routes: RouteRecordRaw[] = [
  { path: "/login", name: "login", component: LoginView, meta: { publica: true } },
  { path: "/", name: "inicio", component: InicioView, meta: { titulo: "Inicio", menu: { icono: "M3 11.5 12 4l9 7.5M5 10v10h14V10", orden: 0 } } },
  // El agente añade aquí una pantalla del plan, p.ej.:
  //   { path: "/clientes", name: "clientes", component: ClientesView,
  //     meta: { titulo: "Clientes", menu: { icono: "<path d del SVG>", orden: 10 } } }
  //   → aparece SOLA en el menú lateral. Detalle/sub (p.ej. /clientes/:id) van SIN meta.menu.
  // Administración (solo admin) — viene de serie con el login/auditoría. No la quites.
  { path: "/admin/usuarios", name: "admin-usuarios", component: UsuariosView, meta: { titulo: "Usuarios", soloAdmin: true, menu: { icono: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75", orden: 90 } } },
  { path: "/admin/accesos", name: "admin-accesos", component: AccesosView, meta: { titulo: "Registro de accesos", soloAdmin: true, menu: { label: "Accesos", icono: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6", orden: 91 } } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.cargado) await auth.cargar();
  if (!to.meta.publica && !auth.autenticado) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.name === "login" && auth.autenticado) {
    return { path: "/" };
  }
  // Área de administración: solo admin (la API también lo exige; esto es UX).
  if (to.meta.soloAdmin && !auth.esAdmin) {
    return { path: "/" };
  }
  return true;
});
