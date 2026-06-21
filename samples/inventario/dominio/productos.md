---
id: doc_sample_productos
title: Productos
tags: [dominio, productos, catalogo]
status: active
updated_at: 2026-06-12T10:00:00Z
---

# Productos

Un **producto** representa un artículo del catálogo que el negocio vende.

## Campos

- `nombre` (texto, obligatorio)
- `sku` (texto, único)
- `precio` (decimal, en euros, sin IVA)
- `stock` (entero, no negativo)
- `activo` (booleano, por defecto true)
- `creado_en` (fecha y hora, automático)

## Reglas

- Un producto con `stock = 0` se sigue mostrando en el listado pero se marca como "sin stock".
- No se puede borrar un producto que haya aparecido en alguna venta — en su lugar, se desactiva (`activo = false`).
- El SKU es inmutable una vez creado.
