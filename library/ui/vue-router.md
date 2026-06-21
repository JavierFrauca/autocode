# Enrutado SPA con Vue Router

**Categoría:** ui | **Cuándo usar:** toda app web con más de una pantalla (lista + detalle + ajustes…). Para escritorio (Electron) suele bastar el mismo patrón en el renderer.

## Concepto
Una sola página (SPA): el router intercambia componentes según la URL sin recargar. Cada ruta monta una **vista** (`views/`). Se navega con `<RouterLink>` (declarativo) o `router.push()` (programático).

## Definición de rutas (con carga perezosa)
```typescript
// src/router/index.ts
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/pedidos" },
  { path: "/pedidos", name: "pedidos", component: () => import("../views/PedidosView.vue") },
  { path: "/pedidos/:id", name: "pedido-detalle", component: () => import("../views/PedidoDetalleView.vue"), props: true },
  { path: "/ajustes", name: "ajustes", component: () => import("../views/AjustesView.vue"), meta: { requiresAuth: true } },
  { path: "/:pathMatch(.*)*", name: "no-encontrado", component: () => import("../views/NoEncontradoView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
```

## Montaje
```typescript
// src/main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router/index.js";

createApp(App).use(router).mount("#app");
```

```vue
<!-- src/App.vue -->
<template>
  <nav>
    <RouterLink to="/pedidos">Pedidos</RouterLink>
    <RouterLink to="/ajustes">Ajustes</RouterLink>
  </nav>
  <main>
    <RouterView />
  </main>
</template>
```

## Navegación programática y parámetros
```typescript
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

function abrir(id: string) {
  router.push({ name: "pedido-detalle", params: { id } });
}

// Leer el parámetro de la URL en la vista de detalle (con props: true llega como prop `id`).
const id = route.params.id as string;
```

## Buenas prácticas
- **Vistas** en `views/` (una por ruta), **componentes** reutilizables en `components/`.
- **Lazy** `() => import()` por ruta → bundles más pequeños y arranque más rápido.
- Marca con `meta.requiresAuth` las rutas privadas y protégelas en un guard (ver `library/auth/auth-frontend`). El guard es UX: **el backend valida igual** cada petición.
- Ruta catch-all `/:pathMatch(.*)*` para un 404 propio.
- Nombres de ruta (`name`) estables: navega por nombre, no por string de path, para no romper enlaces al reorganizar.

Andamiaje listo para copiar: `templates/web/vue-router`.
