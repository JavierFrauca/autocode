# Facturación (España) — reglas mínimas para no inventar la legalidad

**Categoría:** dominio | **Cuándo usar:** SOLO si el dominio incluye una entidad tipo Factura con IVA/totales.
No es una pieza central del andamiaje — la mayoría de proyectos NO la necesitan. Es una chuleta de reglas
correctas para cuando sí hace falta, no un motor de facturación completo (sin asientos contables, sin
presentación de impuestos: eso queda fuera de alcance).

## Campos mínimos de una factura (B2B/B2C simplificada)

- **Serie y número**: correlativo, SIN HUECOS, por serie y año natural (p.ej. `2026/A/00042`). Si se anula una
  factura, NO se borra ni se reutiliza el número: se emite una **rectificativa** que la referencia.
- **Fecha de expedición.**
- **Datos del emisor y del cliente** (NIF/CIF, nombre/razón social, dirección) — obligatorios en factura
  completa; en factura simplificada (ticket, importe bajo) el cliente puede omitirse.
- **Líneas**: concepto, cantidad, precio unitario (sin IVA), % de descuento si aplica, % de IVA aplicable.
- **Totales**: base imponible (suma de líneas tras descuento), desglose de IVA por tipo, total.

## Tipos de IVA vigentes (España, generales — verifica excepciones sectoriales con el usuario)

- **General: 21 %** (la mayoría de bienes/servicios).
- **Reducido: 10 %** (alimentación, transporte, hostelería...).
- **Superreducido: 4 %** (bienes de primera necesidad, libros...).
- **Exento: 0 %** (operaciones exentas, ej. servicios médicos, formación reglada).

No asumas un tipo por defecto sin que el dominio/regla de negocio lo diga — pregúntalo si no está claro.

## Cálculo de totales (el orden importa)

```
Para cada línea:
  importeLinea = cantidad × precioUnitario × (1 − descuento/100)
  ivaLinea     = importeLinea × (tipoIva/100)

baseImponible = Σ importeLinea            (redondeada a 2 decimales AL FINAL, no línea a línea)
ivaTotal      = Σ ivaLinea agrupado por tipo de IVA (desglose obligatorio si hay varios tipos)
total         = baseImponible + ivaTotal
```

**Redondeo**: SIEMPRE a 2 decimales, con `Math.round(x * 100) / 100` (redondeo estándar), y SOLO en el
resultado final de cada magnitud (no redondees en pasos intermedios — arrastra el decimal completo y redondea
al mostrar/guardar el total). Usa `number` con cuidado de errores de coma flotante (o trabaja en céntimos como
enteros si el volumen de operaciones es alto).

## Retenciones (IRPF, si el emisor es autónomo/profesional y el cliente lo exige)

- Añade una línea de retención (típicamente 15 %, o 7 % los primeros años de actividad) que se RESTA del
  total a pagar, pero NO afecta a la base imponible del IVA (son cálculos independientes).

## Verificación (importante — ver `builder-system.md`, sección de tests)

Estos cálculos son el tipo de lógica que MÁS falla si el LLM se autovalida con tests que él mismo inventa.
El paper de la regla de negocio (`reglas/RN-NNN-facturacion.md`) DEBE incluir al menos un ejemplo numérico
completo (p.ej. "2 unidades a 50€ con 21% IVA y 10% descuento = base 90€, IVA 18,90€, total 108,90€") que el
test use como valor esperado literal — no lo calcules tú mismo y luego valides contra tu propio cálculo.

## Reglas

- Nunca reutilices ni dejes huecos en la numeración de serie — es un requisito legal, no solo de diseño.
- El desglose de IVA por tipo va SIEMPRE en el documento si hay líneas con tipos distintos.
- Redondeo consistente y documentado; nunca mezcles redondeo por línea y redondeo por total en el mismo cálculo.
- Si el usuario no especifica un dato legal (tipo de IVA, si aplica retención), pregúntalo — no lo inventes.

Relacionado: `library/persistencia/relaciones-padre-hijo.md` (Factura→Líneas es composición).
