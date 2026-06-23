# Mapas de Google (Google Maps en la app)

**Categoría:** integraciones | **Cuándo usar:** la app necesita MOSTRAR un mapa, situar marcadores
(direcciones de clientes, sedes, incidencias, rutas), buscar una dirección y obtener sus coordenadas
(geocodificación), o autocompletar una dirección mientras el usuario escribe.

**Pieza preparada** para enchufar Google Maps sin fricción. NO es login con Google (eso es
`library/auth/auth-google-oauth.md`): Maps usa **una clave de API**, no la cuenta del usuario.

## Qué necesita el usuario (decírselo en lenguaje llano)

1. Ir a `console.cloud.google.com` → crear un proyecto.
2. **APIs y servicios → Biblioteca** → activar: *Maps JavaScript API* (mapa), *Geocoding API* (dirección↔coordenadas)
   y *Places API* (autocompletar direcciones) según lo que use la app.
3. **Credenciales → Crear credenciales → Clave de API**. Copiar la clave.
4. **Restringir la clave** (importante, va en el navegador): por *referente HTTP* (tu dominio +
   `http://localhost:*` en desarrollo) y a SOLO las APIs activadas. Una clave de mapa NO da acceso a
   datos privados, pero sin restringir se la pueden gastar.

> Maps **factura por uso** (tiene capa gratuita mensual). Es de Google, no de la app. Avísalo en el README.

## Variable de entorno

La clave de mapa es **pública** (viaja al navegador), por eso va con prefijo `VITE_` y se restringe por dominio:

```env
VITE_GOOGLE_MAPS_API_KEY=AIzaSy...
```

## Cargar la API una sola vez (sin dependencias npm)

No hace falta `@googlemaps/js-api-loader`: se carga el script bajo demanda y se cachea la promesa.

```ts
// web/src/lib/google-maps.ts
let promesa: Promise<typeof google.maps> | null = null;

/** Carga la Maps JavaScript API una vez (idempotente). `libraries` p.ej. ["places"] para autocompletar. */
export function cargarMaps(libraries: string[] = []): Promise<typeof google.maps> {
  if (promesa) return promesa;
  const clave = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  if (!clave) return Promise.reject(new Error("Falta VITE_GOOGLE_MAPS_API_KEY"));

  promesa = new Promise((resolve, reject) => {
    const params = new URLSearchParams({ key: clave, v: "weekly", language: "es", region: "ES" });
    if (libraries.length) params.set("libraries", libraries.join(","));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onload = () => resolve(google.maps);
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return promesa;
}
```

Tipos (sin dependencia de runtime): `npm i -D @types/google.maps` y en `web/tsconfig.json` `"types": ["google.maps"]`.
Si no quieres ni los tipos, declara `declare const google: any;` en `env.d.ts`.

## Componente de mapa reutilizable

```vue
<!-- web/src/components/MapaGoogle.vue -->
<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { cargarMaps } from "../lib/google-maps.js";

export interface Marcador { lat: number; lng: number; titulo?: string; }

const props = withDefaults(defineProps<{
  centro?: { lat: number; lng: number };
  zoom?: number;
  marcadores?: Marcador[];
}>(), { centro: () => ({ lat: 40.4168, lng: -3.7038 }), zoom: 12, marcadores: () => [] });

const emit = defineEmits<{ (e: "click-mapa", coords: { lat: number; lng: number }): void }>();

const el = ref<HTMLDivElement>();
let mapa: google.maps.Map | null = null;
let pins: google.maps.Marker[] = [];

function pintar() {
  if (!mapa) return;
  pins.forEach((p) => p.setMap(null));
  pins = props.marcadores.map((m) =>
    new google.maps.Marker({ position: { lat: m.lat, lng: m.lng }, map: mapa!, title: m.titulo }));
}

onMounted(async () => {
  await cargarMaps();
  mapa = new google.maps.Map(el.value!, { center: props.centro, zoom: props.zoom });
  mapa.addListener("click", (e: google.maps.MapMouseEvent) => {
    if (e.latLng) emit("click-mapa", { lat: e.latLng.lat(), lng: e.latLng.lng() });
  });
  pintar();
});

watch(() => props.marcadores, pintar, { deep: true });
watch(() => props.centro, (c) => mapa?.setCenter(c));
</script>

<template>
  <div ref="el" class="mapa" />
</template>

<style scoped>
.mapa { width: 100%; height: 420px; border-radius: var(--radio, 8px); }
</style>
```

Uso: `<MapaGoogle :centro="{ lat, lng }" :marcadores="sedes" @click-mapa="elegirUbicacion" />`.

## Geocodificar (dirección → coordenadas) y autocompletar

```ts
// web/src/lib/geocodificar.ts
import { cargarMaps } from "./google-maps.js";

/** Dirección de texto → {lat,lng}. Usa el Geocoder de la API JS (la misma clave del mapa). */
export async function geocodificar(direccion: string): Promise<{ lat: number; lng: number } | null> {
  await cargarMaps();
  const geocoder = new google.maps.Geocoder();
  const { results } = await geocoder.geocode({ address: direccion, region: "ES" });
  const loc = results[0]?.geometry.location;
  return loc ? { lat: loc.lat(), lng: loc.lng() } : null;
}
```

**Autocompletar direcciones** (carga `["places"]`): engancha un `google.maps.places.Autocomplete` a un
`<input>` y, en su evento `place_changed`, lee `place.geometry.location` + `place.formatted_address`.
Guarda en tu entidad la dirección formateada Y las coordenadas (lat/lng) para no re-geocodificar.

## Sin clave / sin coste: alternativas

- **Insertar un mapa** (iframe, una sola ubicación, sin clave de mapa pero sí Embed API):
  `https://www.google.com/maps/embed/v1/place?key=KEY&q=Calle+Mayor+1,Madrid`.
- **Enlazar** a Google Maps (cero claves, abre la app de mapas):
  `https://www.google.com/maps/search/?api=1&query=40.4168,-3.7038`. Suficiente si solo quieres un botón
  "Ver en el mapa" o "Cómo llegar". Empieza por aquí si las necesidades son mínimas.

## CSP — IMPORTANTE en apps de ESCRITORIO (Electron)

El andamiaje **web** (`templates/server-app`) no fija una CSP estricta → Maps carga sin tocar nada.
El andamiaje **escritorio** (`templates/electron-app`) SÍ trae una CSP estricta en
`src/renderer/index.html` que BLOQUEARÍA Maps (pantalla de mapa en blanco). Si una app Electron usa Maps,
amplía esa `<meta http-equiv="Content-Security-Policy">` añadiendo los orígenes de Google:

```
script-src 'self' https://maps.googleapis.com;
img-src 'self' data: https://*.googleapis.com https://*.gstatic.com https://*.google.com;
connect-src 'self' https://maps.googleapis.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
```

## Reglas

- La clave de mapa es pública pero **restríngela por dominio**; nunca pongas en `VITE_*` una clave de
  servidor con permisos amplios.
- Persiste SIEMPRE lat/lng junto a la dirección (geocodificar cuesta dinero y cuota; hazlo una vez).
- Limpia los marcadores (`setMap(null)`) antes de repintar para no acumular pins fantasma.
- Para datos privados de Google (Drive, Gmail, Calendar) NO es esto: ver `library/integraciones/google-workspace.md`.

Relacionado: login con Google `library/auth/auth-google-oauth.md`; servicios de Google
`library/integraciones/google-workspace.md`.
