<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";

/**
 * Pantalla de login. SIEMPRE presente en apps web. Base: sistema propio (email + contraseña).
 *
 * Proveedores externos (Google, Microsoft/Entra): pon `proveedoresExternos = true` y crea los endpoints
 * /api/auth/google y /api/auth/microsoft en el servidor (ver library/auth/login-system.md,
 * library/auth/auth-google-oauth.md y library/auth/auth-microsoft-entra.md). El callback emite la MISMA
 * cookie de sesión. MFA (TOTP): ver library/auth/auth-mfa-totp.md (paso extra tras validar la contraseña).
 */
const proveedoresExternos = false;

const email = ref("");
const password = ref("");
const error = ref("");
const cargando = ref(false);
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

async function entrar(): Promise<void> {
  error.value = "";
  cargando.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push((route.query.redirect as string) ?? "/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "No se pudo entrar";
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="card login__card" @submit.prevent="entrar">
      <div class="login__marca"><span class="login__logo">◆</span> Mi aplicación</div>
      <h1 class="login__titulo">Iniciar sesión</h1>

      <div v-if="proveedoresExternos" class="login__proveedores">
        <a class="btn btn--block" href="/api/auth/google">Continuar con Google</a>
        <a class="btn btn--block" href="/api/auth/microsoft">Continuar con Microsoft</a>
        <div class="login__sep"><span>o con tu cuenta</span></div>
      </div>

      <div class="field">
        <label for="email">Correo electrónico</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn btn--primary btn--block" type="submit" :disabled="cargando">
        {{ cargando ? "Entrando…" : "Entrar" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100%; display: grid; place-items: center; padding: 24px; }
.login__card { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; }
.login__marca { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text-muted); }
.login__logo { color: var(--accent); font-size: 18px; }
.login__titulo { margin: 0 0 4px; font-size: 1.3rem; }
.login__proveedores { display: flex; flex-direction: column; gap: 8px; }
.login__sep { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; margin: 4px 0; }
.login__sep::before, .login__sep::after { content: ""; flex: 1; height: 1px; background: var(--border); }
</style>
