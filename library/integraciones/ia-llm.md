# IA — cliente LLM compatible con OpenAI

**Categoría:** integraciones | **Cuándo usar:** la app necesita generar texto, clasificar, resumir,
extraer datos o chatear usando un modelo de lenguaje (asistente dentro de la app, redacción asistida,
clasificación de tickets, extracción de campos de un texto libre…).

## Elección de proveedor

El endpoint `/v1/chat/completions` (formato "OpenAI-compatible") lo exponen, con la MISMA forma, muchos
proveedores distintos — cambiar de uno a otro es solo cambiar `LLM_BASE_URL` + `LLM_API_KEY`, el código
no cambia:

| Opción | Cuándo elegirla |
|---|---|
| **OpenAI directo** (`api.openai.com/v1`) | El caso simple: una cuenta, una clave. |
| **Azure OpenAI** | Ya tienes contrato/cumplimiento con Azure. |
| **Un gateway propio (LiteLLM, OpenRouter…)** | Quieres poder cambiar de modelo/proveedor sin tocar código, o centralizar el gasto de varias apps. |
| **Ollama local** (`http://localhost:11434/v1`) | Sin coste por token, todo en la máquina del usuario — a costa de calidad/velocidad frente a un modelo grande en la nube. |

## Variables de entorno

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-xxxxxxxxxxxx
LLM_MODEL=gpt-4o-mini
```

## Cliente

```typescript
// services/llm.ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Llama a un endpoint /v1/chat/completions compatible con OpenAI. Funciona igual con OpenAI, Azure
 * OpenAI, un gateway (LiteLLM/OpenRouter) o Ollama en local — solo cambia LLM_BASE_URL/LLM_API_KEY.
 * SIEMPRE se llama desde el backend (o el proceso principal en Electron): la clave NUNCA viaja al
 * navegador/renderer.
 */
export async function chatCompletion(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) throw new Error("Falta LLM_API_KEY (configúrala en las variables de entorno).");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`El servicio de IA respondió con error ${res.status}: ${detalle.slice(0, 300)}`);
  }
  const data = await res.json();
  const texto = data?.choices?.[0]?.message?.content;
  if (typeof texto !== "string") throw new Error("El servicio de IA no devolvió una respuesta válida.");
  return texto;
}
```

## Streaming (opcional — respuesta palabra a palabra)

```typescript
// services/llm.ts (añadir)
export async function* chatCompletionStream(messages: ChatMessage[], opts: ChatOpts = {}): AsyncGenerator<string> {
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) throw new Error("Falta LLM_API_KEY.");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.3, stream: true }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`El servicio de IA respondió con error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lineas = buffer.split("\n");
    buffer = lineas.pop() ?? "";
    for (const linea of lineas) {
      const l = linea.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* fragmento parcial, se completa en la siguiente vuelta */ }
    }
  }
}
```

## Uso

```typescript
// routes/asistente.ts (server-app / api-server)
import { chatCompletion } from "../services/llm.js";

app.post("/api/asistente", { config: { roles: ["usuario"] } }, async (req, reply) => {
  const { pregunta } = req.body as { pregunta: string };
  try {
    const respuesta = await chatCompletion([
      { role: "system", content: "Eres el asistente de la app. Responde breve y en español." },
      { role: "user", content: pregunta },
    ]);
    return { respuesta };
  } catch (e: any) {
    return reply.code(502).send({ error: "El asistente no está disponible ahora mismo." });
  }
});
```

En **electron-app**, llama a `chatCompletion` desde `src/main` (nunca desde el renderer) y expón un caso
de uso por IPC, igual que cualquier otro caso de uso del dominio (ver `library/ui` → patrón IPC del
andamiaje de escritorio).

## Reglas

- **La clave NUNCA va al frontend.** Todas las llamadas pasan por el backend/proceso principal; el
  renderer/SPA solo llama a TU endpoint/IPC, nunca directamente a `LLM_BASE_URL`.
- **Timeout siempre** (los modelos pueden tardar) y captura el error para devolver un mensaje en
  lenguaje llano al usuario, nunca la excepción cruda.
- **No inventes campos que el modelo no pidió** ni le pases datos sensibles innecesarios en el prompt.
- Si la respuesta debe ser JSON estructurado, pide explícitamente el formato en el `system` y valida con
  Zod lo que vuelva — no asumas que el modelo siempre acierta la forma.
- Para elegir entre respuesta completa (`chatCompletion`) y streaming (`chatCompletionStream`): usa
  streaming solo si la UI va a mostrar el texto según llega (un chat); si solo necesitas el resultado
  final (clasificar, extraer datos), usa la versión simple.

Relacionado: `library/integraciones/ia-embeddings.md` (búsqueda semántica sobre los propios documentos
de la app, con el mismo proveedor).
