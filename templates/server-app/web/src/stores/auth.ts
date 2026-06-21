import { defineStore } from "pinia";
import { ref, computed } from "vue";

/**
 * Sesión del usuario en el front. La autenticación real vive en una cookie httpOnly del servidor; el
 * front NO maneja tokens — solo pregunta "¿quién soy?" a /api/auth/me. `cargar()` se llama una vez
 * (desde el guard del router) para saber si hay sesión al abrir la app.
 */
export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: string;
}

export const useAuthStore = defineStore("auth", () => {
  const usuario = ref<Usuario | null>(null);
  const cargado = ref(false);
  const autenticado = computed(() => !!usuario.value);
  const esAdmin = computed(() => usuario.value?.rol === "admin");

  async function cargar(): Promise<void> {
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" });
      usuario.value = r.ok ? ((await r.json()) as Usuario | null) : null;
    } catch {
      usuario.value = null;
    } finally {
      cargado.value = true;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo entrar");
    usuario.value = ((await r.json()) as { usuario: Usuario }).usuario;
  }

  async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    usuario.value = null;
  }

  return { usuario, cargado, autenticado, esAdmin, cargar, login, logout };
});
