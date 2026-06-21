# Template: Vue 3 App Shell con Router

**tags:** vue3, router, typescript, spa
**transversal:** true

```typescript
// src/web/main.ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: HomeView },
    // Añadir rutas por pantalla
  ],
});

createApp(App).use(createPinia()).use(router).mount("#app");
```

```vue
<!-- src/web/App.vue -->
<template>
  <div class="app">
    <nav class="nav">
      <router-link to="/">Inicio</router-link>
      <!-- añadir enlaces de navegación -->
    </nav>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; }
.app { min-height: 100vh; display: flex; flex-direction: column; }
.nav { background: #1a1a2e; color: white; padding: 0 24px; display: flex; gap: 20px; align-items: center; height: 52px; }
.nav a { color: rgba(255,255,255,0.8); text-decoration: none; padding: 6px 10px; border-radius: 4px; }
.nav a:hover, .nav a.router-link-active { color: white; background: rgba(255,255,255,0.1); }
.main { flex: 1; padding: 24px; max-width: 1200px; margin: 0 auto; width: 100%; }
</style>
```
