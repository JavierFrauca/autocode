import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import InicioView from "./views/InicioView.vue";

/**
 * Router del renderer. En Electron empaquetado el renderer se carga con file://, así que usamos
 * HASH history (no necesita servidor que reescriba rutas).
 *
 * MENÚ LATERAL AUTOMÁTICO: el sidebar (`AppSidebar.vue`) se DERIVA de estas rutas — toda ruta con
 * `meta.menu` aparece sola en el menú. Para añadir una pantalla del plan basta registrarla aquí con
 * `meta.menu`; NO toques AppSidebar.vue. `meta.menu.icono` = atributo `d` de un <path> SVG; `orden` ordena;
 * `label` (opcional) es el texto del menú (por defecto `titulo`). Las pantallas de DETALLE/secundarias
 * (p.ej. `/clientes/:id`) van SIN `meta.menu` (no salen en el menú).
 */
export const routes: RouteRecordRaw[] = [
  { path: "/", name: "inicio", component: InicioView, meta: { titulo: "Inicio", menu: { icono: "M3 11.5 12 4l9 7.5M5 10v10h14V10", orden: 0 } } },
  // El agente añade aquí una pantalla del plan, p.ej.:
  //   { path: "/clientes", name: "clientes", component: ClientesView,
  //     meta: { titulo: "Clientes", menu: { icono: "<path d del SVG>", orden: 10 } } }
  //   → aparece SOLA en el menú lateral. Detalle/sub (p.ej. /clientes/:id) van SIN meta.menu.
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
