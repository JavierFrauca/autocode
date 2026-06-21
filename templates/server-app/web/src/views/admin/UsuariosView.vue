<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../lib/api";

// Gestión de usuarios (solo admin). Viene de serie con el login. NO la recrees; el agente añade campos
// al dominio, no aquí.
interface Usuario { id: string; email: string; nombre: string; rol: string; activo: number; ultimoAcceso: string | null }

const usuarios = ref<Usuario[]>([]);
const cargando = ref(true);
const error = ref("");
const nuevo = ref({ email: "", nombre: "", rol: "usuario", password: "" });

async function cargar(): Promise<void> {
  cargando.value = true;
  error.value = "";
  try { usuarios.value = await api<Usuario[]>("/auth/usuarios"); }
  catch (e) { error.value = e instanceof Error ? e.message : "No se pudo cargar"; }
  finally { cargando.value = false; }
}
async function crear(): Promise<void> {
  error.value = "";
  try {
    await api("/auth/registro", { method: "POST", body: JSON.stringify(nuevo.value) });
    nuevo.value = { email: "", nombre: "", rol: "usuario", password: "" };
    await cargar();
  } catch (e) { error.value = e instanceof Error ? e.message : "No se pudo crear"; }
}
async function patch(u: Usuario, cambio: Record<string, unknown>): Promise<void> {
  error.value = "";
  try { await api(`/auth/usuarios/${u.id}`, { method: "PATCH", body: JSON.stringify(cambio) }); await cargar(); }
  catch (e) { error.value = e instanceof Error ? e.message : "No se pudo actualizar"; }
}
onMounted(cargar);
</script>

<template>
  <section class="card">
    <h2>Usuarios</h2>
    <form class="alta no-print" @submit.prevent="crear">
      <input class="input" v-model="nuevo.email" type="email" placeholder="Correo" required />
      <input class="input" v-model="nuevo.nombre" placeholder="Nombre" required />
      <select class="select" v-model="nuevo.rol">
        <option value="usuario">usuario</option><option value="gestor">gestor</option><option value="admin">admin</option>
      </select>
      <input class="input" v-model="nuevo.password" type="password" placeholder="Contraseña (mín. 8)" required />
      <button class="btn btn--primary" type="submit">Crear usuario</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="cargando" class="muted">Cargando…</p>
    <table v-else class="tabla">
      <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th class="no-print"></th></tr></thead>
      <tbody>
        <tr v-for="u in usuarios" :key="u.id">
          <td>{{ u.email }}</td>
          <td>{{ u.nombre }}</td>
          <td>
            <select class="select" :value="u.rol" @change="patch(u, { rol: ($event.target as HTMLSelectElement).value })">
              <option value="usuario">usuario</option><option value="gestor">gestor</option><option value="admin">admin</option>
            </select>
          </td>
          <td><span class="pill">{{ u.activo ? "activo" : "inactivo" }}</span></td>
          <td>{{ u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleString() : "—" }}</td>
          <td class="no-print">
            <button class="btn" @click="patch(u, { activo: !u.activo })">{{ u.activo ? "Desactivar" : "Activar" }}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.alta { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 18px; }
.tabla { width: 100%; border-collapse: collapse; }
.tabla th, .tabla td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
</style>
