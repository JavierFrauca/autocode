# Template: Vue Router (andamiaje)

**tags:** vue, vue-router, spa, routing

Dependencia: `vue-router` (ya en el stack). Copia estos tres ficheros y añade tus vistas.

```typescript
// src/router/index.ts
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/inicio" },
  { path: "/inicio", name: "inicio", component: () => import("../views/InicioView.vue") },
  { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
  // Ejemplo de ruta protegida:
  // { path: "/ajustes", name: "ajustes", component: () => import("../views/AjustesView.vue"), meta: { requiresAuth: true } },
  { path: "/:pathMatch(.*)*", name: "no-encontrado", component: () => import("../views/NoEncontradoView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guard de navegación: protege las rutas con meta.requiresAuth.
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.estaAutenticado) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  return true;
});
```

```typescript
// src/main.ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router/index.js";

createApp(App).use(createPinia()).use(router).mount("#app");
```

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <nav class="nav">
    <RouterLink to="/inicio">Inicio</RouterLink>
  </nav>
  <main>
    <RouterView />
  </main>
</template>
```

Si usas el guard, necesitas el store de auth de `library/auth/auth-frontend`. Si la app no tiene login, quita el `beforeEach` y el import.
