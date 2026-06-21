# WebSocket en Fastify — comunicación en tiempo real

**Categoría:** integraciones | **Cuándo usar:** Notificaciones en tiempo real, chats, actualizaciones de estado de pedidos, dashboards en vivo.

## Setup del servidor

```typescript
// server.ts
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";

const app = Fastify();
await app.register(fastifyWebsocket);
```

## Ruta WebSocket básica

```typescript
// routes/notificaciones.ts
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

// Mapa de conexiones activas por usuario
const conexiones = new Map<string, Set<WebSocket>>();

export async function registerWsRoutes(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const userId = (req.query as any).userId as string;
    if (!userId) return socket.close(1008, "userId requerido");

    // Registrar conexión
    if (!conexiones.has(userId)) conexiones.set(userId, new Set());
    conexiones.get(userId)!.add(socket);

    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      // Procesar mensajes entrantes del cliente si los hay
      console.log(`[ws] mensaje de ${userId}:`, msg);
    });

    socket.on("close", () => {
      conexiones.get(userId)?.delete(socket);
      if (conexiones.get(userId)?.size === 0) conexiones.delete(userId);
    });

    socket.send(JSON.stringify({ type: "conectado", userId }));
  });
}

// Función para enviar notificación desde cualquier handler
export function notificarUsuario(userId: string, evento: object) {
  const sockets = conexiones.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify(evento);
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(msg);  // 1 = OPEN
  }
}

// Broadcast a todos los conectados
export function broadcast(evento: object) {
  const msg = JSON.stringify(evento);
  for (const sockets of conexiones.values()) {
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}
```

## Uso desde un Command Handler

```typescript
// Después de crear un pedido, notificar al cliente
import { notificarUsuario } from "../routes/notificaciones.js";

export class CrearPedidoHandler {
  async handle(cmd: CrearPedidoCommand): Promise<string> {
    const id = ulid().toLowerCase();
    await this.pedidoRepo.create({ id, ...cmd });

    notificarUsuario(cmd.clienteId, {
      type: "PedidoCreado",
      pedidoId: id,
      mensaje: "Tu pedido ha sido recibido",
    });

    return id;
  }
}
```

## Cliente Vue con WebSocket

```typescript
// composables/useWebSocket.ts
import { ref, onUnmounted } from "vue";

export function useWebSocket(userId: string) {
  const conectado = ref(false);
  const mensajes  = ref<any[]>([]);
  let ws: WebSocket | null = null;

  function conectar() {
    const url = `ws://localhost:3000/ws?userId=${userId}`;
    ws = new WebSocket(url);

    ws.onopen    = () => { conectado.value = true; };
    ws.onclose   = () => { conectado.value = false; setTimeout(conectar, 3000); }; // reconectar
    ws.onmessage = (e) => { mensajes.value.push(JSON.parse(e.data)); };
    ws.onerror   = () => ws?.close();
  }

  function enviar(data: object) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  conectar();
  onUnmounted(() => ws?.close());

  return { conectado, mensajes, enviar };
}
```

## Uso en componente Vue

```vue
<script setup lang="ts">
import { useAuthStore } from "../stores/authStore.js";
import { useWebSocket } from "../composables/useWebSocket.js";

const auth = useAuthStore();
const { conectado, mensajes } = useWebSocket(auth.usuario!.id);
</script>

<template>
  <span :class="conectado ? 'verde' : 'rojo'">● Live</span>
  <div v-for="msg in mensajes" :key="msg.type">{{ msg.mensaje }}</div>
</template>
```

## Dependencias

```
npm install @fastify/websocket
```
