# Template: LoginView completa (sistema propio + proveedores + MFA)

**tags:** vue3, auth, login, mfa, oauth | **Cuándo usar:** apps web cuando el ADR pide proveedores externos
y/o MFA. Sustituye la `web/src/views/LoginView.vue` del andamiaje (que trae solo el sistema propio). El
backend de cada proveedor va en `library/auth/login-system.md` (todos emiten la MISMA cookie de sesión).

Usa los tokens del tema (`library/ui/tema-tokens.md`) — sin colores sueltos.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";

// Activa solo los que el ADR pida:
const usaGoogle = true;
const usaMicrosoft = true;

const email = ref("");
const password = ref("");
const codigoMfa = ref("");
const fase = ref<"credenciales" | "mfa">("credenciales");
const error = ref("");
const cargando = ref(false);
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

async function entrar(): Promise<void> {
  error.value = "";
  cargando.value = true;
  try {
    // login() devuelve { mfaRequerido: true } si el usuario tiene MFA y aún no se ha validado el código.
    const r = await auth.login(email.value, password.value, fase.value === "mfa" ? codigoMfa.value : undefined);
    if (r?.mfaRequerido) { fase.value = "mfa"; return; }
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

      <template v-if="fase === 'credenciales'">
        <div v-if="usaGoogle || usaMicrosoft" class="login__proveedores">
          <a v-if="usaGoogle" class="btn btn--block" href="/api/auth/google">Continuar con Google</a>
          <a v-if="usaMicrosoft" class="btn btn--block" href="/api/auth/microsoft">Continuar con Microsoft</a>
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
      </template>

      <template v-else>
        <p class="muted">Introduce el código de 6 dígitos de tu app de autenticación.</p>
        <div class="field">
          <label for="mfa">Código MFA</label>
          <input id="mfa" v-model="codigoMfa" class="input" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" required />
        </div>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn btn--primary btn--block" type="submit" :disabled="cargando">
        {{ cargando ? "Entrando…" : fase === "mfa" ? "Verificar" : "Entrar" }}
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
```

Para el paso MFA, el `stores/auth.ts` debe aceptar un tercer argumento (código) y devolver
`{ mfaRequerido: true }` cuando el backend pida el segundo factor. Ver `library/auth/auth-mfa-totp.md`.
