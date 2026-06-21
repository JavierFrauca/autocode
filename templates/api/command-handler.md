# Template: Command Handler

**tags:** cqrs, command, handler, typescript
**transversal:** true

Reemplaza `CrearEntidad` y campos por los de tu dominio.

```typescript
// src/commands/CrearEntidadCommand.ts
import { ulid } from "ulid";
import type { EntidadRepository } from "../repositories/EntidadRepository.js";

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface CrearEntidadCommand {
  readonly nombre:      string;
  readonly descripcion: string | undefined;
  readonly usuarioId:   string;
  // añadir campos según modelo
}

// ── Handler ──────────────────────────────────────────────────────────────────
export class CrearEntidadHandler {
  constructor(private repo: EntidadRepository) {}

  async handle(cmd: CrearEntidadCommand): Promise<string> {
    // 1. Validar reglas de negocio
    const existe = await this.repo.findByNombre(cmd.nombre);
    if (existe) throw new Error("NEGOCIO: Ya existe una entidad con ese nombre");

    // 2. Construir entidad
    const id  = ulid().toLowerCase();
    const now = new Date().toISOString();

    // 3. Persistir
    await this.repo.create({
      id,
      nombre:      cmd.nombre,
      descripcion: cmd.descripcion ?? null,
      usuarioId:   cmd.usuarioId,
      creadoEn:    now,
      actualizadoEn: now,
    });

    // 4. Publicar evento (si se usa Event Bus)
    // eventBus.publish({ type: "EntidadCreada", occurredAt: new Date(), entidadId: id });

    // 5. Devolver solo el ID
    return id;
  }
}
```

```typescript
// src/commands/ActualizarEntidadCommand.ts
export interface ActualizarEntidadCommand {
  readonly id:          string;
  readonly nombre?:     string;
  readonly descripcion?: string;
  readonly usuarioId:   string;
}

export class ActualizarEntidadHandler {
  constructor(private repo: EntidadRepository) {}

  async handle(cmd: ActualizarEntidadCommand): Promise<{ id: string } | null> {
    const entidad = await this.repo.findById(cmd.id);
    if (!entidad) return null;

    // Verificar propietario si aplica
    // if (entidad.usuarioId !== cmd.usuarioId) throw new Error("NEGOCIO: Sin permisos");

    return this.repo.update(cmd.id, {
      ...(cmd.nombre      !== undefined && { nombre: cmd.nombre }),
      ...(cmd.descripcion !== undefined && { descripcion: cmd.descripcion }),
      actualizadoEn: new Date().toISOString(),
    });
  }
}
```

```typescript
// src/commands/EliminarEntidadCommand.ts
export class EliminarEntidadHandler {
  constructor(private repo: EntidadRepository) {}

  async handle(id: string): Promise<void> {
    const entidad = await this.repo.findById(id);
    if (!entidad) throw new Error("NEGOCIO: Entidad no encontrada");

    // Verificar que se puede eliminar (relaciones, estado, etc.)
    // const tieneHijos = await this.hijoRepo.existsByEntidadId(id);
    // if (tieneHijos) throw new Error("NEGOCIO: No se puede eliminar con hijos asociados");

    await this.repo.delete(id);
  }
}
```
