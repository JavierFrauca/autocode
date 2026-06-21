---
id: doc_sample_proveedores
title: Proveedores
tags: [dominio, proveedores]
status: active
updated_at: 2026-06-12T10:00:00Z
---

# Proveedores

Quién nos suministra los productos.

## Campos

- `nombre` (texto, obligatorio)
- `email` (texto)
- `telefono` (texto)
- `notas` (texto largo)

## Reglas

- Un proveedor puede suministrar varios productos.
- Si se desactiva un proveedor, sus productos quedan marcados como "sin proveedor activo" pero siguen visibles.
