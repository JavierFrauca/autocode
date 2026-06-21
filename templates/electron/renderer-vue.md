# Template: renderer (index.html + main.ts + App.vue)

**tags:** electron, renderer, vue, html, mount
**transversal:** true
**Cuándo usar:** la UI de la app (Vue). El renderer corre en el navegador de Electron → su tsconfig lleva `dom`. Este esqueleto YA pinta algo y prueba el round-trip con el main (`ping`).

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mi App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/renderer/src/main.ts`:
```typescript
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
```

`src/renderer/src/App.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";

const saludo = ref("Cargando…");

onMounted(async () => {
  // round-trip renderer → preload → main → IPC. Si esto muestra "pong", el cableado es correcto.
  saludo.value = await window.api.ping();
});
</script>

<template>
  <main class="app">
    <h1>Mi aplicación</h1>
    <p>Estado del proceso principal: <strong>{{ saludo }}</strong></p>
  </main>
</template>

<style>
:root { color-scheme: light dark; }
body { margin: 0; font-family: system-ui, sans-serif; }
.app { padding: 24px; }
</style>
```

## Notas (para evitar el "se abre pero no se ve nada")
- El `<div id="app">` + `createApp(App).mount("#app")` es lo que hace que SE VEA algo. Si falta el `mount` o el id no coincide, la ventana sale en blanco.
- El `<script type="module" src="/src/main.ts">` apunta a la entrada del renderer (Vite la resuelve).
- `window.api.ping()` compila porque `src/preload/index.d.ts` declara `window.api` y el tsconfig del renderer tiene `dom`.
- Componentes/vistas en `src/renderer/src/components` y `src/renderer/src/views`; stores Pinia en `src/renderer/src/stores`.
