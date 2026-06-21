# Notificaciones (toasts)

**Categoría:** ui | **Cuándo usar:** avisos breves NO bloqueantes (guardado correcto, error de red,
"sin permisos"…). Para confirmar/pedir datos usa diálogos (`templates/web/dialogs.md` / `lib/dialogs`),
no toasts.

**Ya viene en el andamiaje** (web y escritorio): store `stores/toasts.ts` + componente `ToastHost.vue`
montado una vez en `App.vue`. NO lo recrees. Uso desde cualquier componente:

```ts
import { useToastStore } from "../stores/toasts";

const toast = useToastStore();
toast.ok("Cliente guardado");
toast.error("No se pudo guardar");
toast.info("Sincronizando…");
toast.warn("Quedan 3 días de licencia");
// genérico: toast.mostrar("texto", "ok" | "error" | "info" | "warn", milisegundos)
```

## Reglas

- Un toast por evento; mensajes cortos y en lenguaje de usuario. No los uses para errores de validación de
  un formulario (esos van junto al campo) ni para confirmaciones (diálogo).
- Se auto-cierran (ok/info 4s, warn 5s, error 6s) y se pueden cerrar al pulsarlos.
- Están marcados `.no-print` (no salen en informes). Colores por estado vía tokens del tema
  (`library/ui/tema-tokens.md`).

Relacionado: diálogos `templates/web/dialogs.md`, tema `library/ui/tema-tokens.md`.
