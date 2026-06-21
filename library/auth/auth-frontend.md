# Autenticación en el frontend (login, sesión de cliente y guard)

**Categoría:** auth | **Cuándo usar:** apps web con login. Complementa el backend (`library/auth/jwt`, `library/auth/auth-local-completo`): aquí va lo que vive en el navegador.

## Las tres piezas
1. **Store de sesión** (Pinia): guarda el token/usuario y dice si hay sesión.
2. **Cliente HTTP** que adjunta el token y reacciona al 401 (sesión caducada → fuera).
3. **Guard de ruta** que manda a `/login` lo que requiera sesión (ver `library/ui/vue-router`).

> Regla de oro: el frontend NO es la frontera de seguridad. El guard y el `requiresAuth` son UX. **Cada petición la valida el backend** con el middleware (`library/auth/roles-middleware`).

## 1) Store de sesión
```typescript
// src/stores/auth.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";

interface Usuario { id: string; nombre: string; rol: string; }

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const usuario = ref<Usuario | null>(JSON.parse(localStorage.getItem("usuario") ?? "null"));

  const estaAutenticado = computed(() => !!token.value);

  function entrar(nuevoToken: string, datos: Usuario) {
    token.value = nuevoToken;
    usuario.value = datos;
    localStorage.setItem("token", nuevoToken);
    localStorage.setItem("usuario", JSON.stringify(datos));
  }

  function salir() {
    token.value = null;
    usuario.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
  }

  return { token, usuario, estaAutenticado, entrar, salir };
});
```

## 2) Cliente HTTP (adjunta el Bearer, gestiona el 401)
```typescript
// src/api/http.ts
import { useAuthStore } from "../stores/auth.js";
import { router } from "../router/index.js";

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const auth = useAuthStore();
  const res = await fetch(`/api${url}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...opts.headers,
    },
  });

  if (res.status === 401) {
    auth.salir();
    router.push({ name: "login" });
    throw new Error("Sesión caducada");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
```

## 3) Vista de login
```vue
<!-- src/views/LoginView.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { api } from "../api/http.js";

const email = ref("");
const password = ref("");
const error = ref("");
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

async function enviar() {
  error.value = "";
  try {
    const r = await api<{ token: string; usuario: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    auth.entrar(r.token, r.usuario);
    router.push((route.query.redirect as string) ?? "/inicio");
  } catch (e: any) {
    error.value = "Email o contraseña incorrectos";
  }
}
</script>

<template>
  <form @submit.prevent="enviar">
    <input v-model="email" type="email" name="email" placeholder="Email" required />
    <input v-model="password" type="password" name="password" placeholder="Contraseña" required />
    <p v-if="error" class="error">{{ error }}</p>
    <button type="submit">Entrar</button>
  </form>
</template>
```

## Sobre dónde guardar el token
`localStorage` es lo más simple y suficiente para apps de gestión internas (lo usado arriba). Si el token debe sobrevivir a XSS con más garantías, emite una **cookie httpOnly** desde el backend (`library/auth/sesion-cookies`) y omite el header `authorization`. No mezcles los dos.
