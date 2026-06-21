# Dashboards (paneles de control): cuándo proponerlos y cómo diseñarlos

**tags:** dashboard, panel, kpi, metricas, ux, alcance, planificacion
**Cuándo usar:** guía para DECIDIR si una app merece dashboard(s) y, si procede, cómo dimensionarlos.
La implementación (componentes Vue/SVG sin librerías) está en `templates/web/dashboard.md`.

## ¿Está justificado un dashboard? (criterio)
Propón panel(es) de control **solo si se cumplen varias** de estas (no por defecto):
- La app **gestiona registros** con magnitudes **agregables**: importes, cantidades, conteos, fechas, estados.
- Es de **gestión/administración** (CRUD de un dominio con volumen), no una **utilidad de un solo paso**.
- Hay algo que el usuario querría **vigilar o comparar**: totales, tendencias en el tiempo, distribución, "últimos N", alertas/pendientes.
- Hay **entidad suficiente**: varias entidades relacionadas o un dominio con histórico.

**NO** metas dashboard si la app es una utilidad puntual sin datos agregables (un conversor, un visor, un editor de un fichero sin histórico). En ese caso, como mucho, un **panel de RESUMEN** pequeño (totales del documento actual), no un dashboard completo.

## ¿Cuántos?
- **Uno** (general) si hay un único dominio principal. Es lo normal.
- **Varios** si hay **áreas claramente diferenciadas** (p.ej. ventas / inventario / usuarios) o **roles** con focos distintos (un panel para gestor, otro para admin). Un dashboard por área/rol, no uno gigante.
- Regla práctica: si dudas, **uno**. Añade más solo cuando el alcance lo pida de verdad.

## Qué lleva cada dashboard
- **3–5 KPIs** (las métricas clave del dominio) con valor + tendencia (▲/▼ vs periodo anterior).
- **1–2 gráficos**: tendencia temporal (barras/líneas) y/o composición (donut por categoría/estado).
- Una **tabla de "últimos N"** (movimientos/registros recientes) con estado.
- Un **selector de rango** (7 días / 30 días / 12 meses) si hay dato temporal.
- Opcional: tarjetas de **alertas/pendientes** (lo que requiere acción).

## Cómo elegir las métricas
- Mira las **entidades y sus magnitudes** en los papers: ¿qué se suma, se cuenta, cambia de estado, tiene fecha?
- KPIs = los números que un responsable miraría primero (total facturado, nº pedidos, activos, ticket medio, pendientes…).
- Gráfico temporal = la magnitud principal por mes/semana. Donut = reparto por categoría/estado/tipo.

## Contrato de datos (el dashboard recibe agregados YA calculados)
El dashboard **no calcula negocio**: un servicio/handler de la capa `application` devuelve los agregados y la vista solo los pinta. Contrato recomendado (encaja con los componentes de `templates/web/dashboard.md`):

```ts
// application/dashboard/DashboardData.ts — lo produce un handler; la vista solo lo consume.
export interface DashboardData {
  kpis: { label: string; value: string; delta?: { pct: string; dir: "up" | "down"; vs?: string } }[];
  serieTemporal: { label: string; value: number }[]; // p.ej. importe por mes → <BarChart :items="...">
  distribucion: { label: string; value: number; color: string }[]; // reparto por categoría/estado → <DonutChart>
  ultimos: Record<string, unknown>[]; // últimos N registros para la tabla
}
```

## Reglas de diseño
- **Sin librerías de charting**: barras con CSS, donut/líneas con SVG (ver la plantilla). Bundle ligero, sin deps nativas.
- El dashboard **no calcula negocio**: recibe el `DashboardData` ya hecho de un servicio/handler (capa application) — coherente con la arquitectura hexagonal.
- Accesible y con tema (claro/oscuro), tipografía y espaciado profesionales.
- Carga perezosa si los agregados son caros; estados de "cargando" y "sin datos".
