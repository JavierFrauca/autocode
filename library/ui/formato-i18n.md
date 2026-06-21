# Formato local e i18n ligero (Intl)

**Categoría:** ui | **Cuándo usar:** apps de negocio (facturación, fechas, importes). Formatea con `Intl`, nunca a mano.

## Fechas, moneda y números con Intl
`Intl` está en el navegador y en Node: sin dependencias.

```typescript
// src/shared/formato.ts
const LOCALE = "es-ES";

export function fecha(d: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(new Date(d));
}

export function fechaHora(d: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

export function euros(importe: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR" }).format(importe);
}

export function numero(n: number, decimales = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n);
}
```

## Uso en Vue
```vue
<script setup lang="ts">
import { euros, fecha } from "../shared/formato.js";
defineProps<{ pedido: { total: number; creadoEn: string } }>();
</script>

<template>
  <p>{{ euros(pedido.total) }} · {{ fecha(pedido.creadoEn) }}</p>
</template>
```

## i18n ligero (un idioma, textos centralizados)
Para la mayoría de apps internas basta con centralizar los textos (sin librería). Si más adelante hace falta multi-idioma, se migra a `vue-i18n` sin tocar las vistas.

```typescript
// src/shared/textos.ts
export const t = {
  pedidos: { titulo: "Pedidos", nuevo: "Nuevo pedido", vacio: "No hay pedidos todavía" },
  comun: { guardar: "Guardar", cancelar: "Cancelar", borrar: "Borrar" },
} as const;
```

```vue
<template>
  <h1>{{ t.pedidos.titulo }}</h1>
  <button>{{ t.comun.guardar }}</button>
</template>
```

## Reglas
- **Importes como número** en el dominio y la BD; formatea SOLO al mostrar. Nunca guardes "12,50 €" como string.
- Una sola fuente de `LOCALE`/`currency`: cambiarlo se hace en un único sitio.
- Fechas en ISO (`toISOString`) en la BD y la API; el formato local vive solo en la UI.
