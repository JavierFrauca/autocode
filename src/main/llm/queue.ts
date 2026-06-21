/**
 * Mutex asíncrono FIFO con adquisición opcional con tope de tiempo.
 *
 * Lo usa la cola de embeddings: Ollama atiende un bge-m3 cada vez, así que serializamos las
 * llamadas. Las interactivas (búsqueda del chat) piden el turno con `timeoutMs`: si la cola está
 * ocupada por un `ingest` largo, ceden (EmbedBusyError) en vez de bloquear la conversación.
 */

export class EmbedBusyError extends Error {
  constructor() {
    super("cola de embeddings ocupada");
    this.name = "EmbedBusyError";
  }
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (e: any) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class Mutex {
  private locked = false;
  private waiters: Waiter[] = [];

  /** Adquiere el lock. Devuelve la función para liberarlo. Con `timeoutMs`, rechaza con
   *  EmbedBusyError si no obtiene el turno a tiempo. */
  acquire(timeoutMs?: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (timeoutMs && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new EmbedBusyError());
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      next.resolve(() => this.release()); // la propiedad del lock pasa al siguiente; sigue "locked"
    } else {
      this.locked = false;
    }
  }
}
