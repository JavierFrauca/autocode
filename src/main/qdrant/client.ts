export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QdrantSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export class QdrantClient {
  constructor(private readonly baseUrl: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const r = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Qdrant ${path} -> ${r.status}: ${text}`);
    }
    return r.json();
  }

  async ping(): Promise<boolean> {
    try {
      await this.req("/");
      return true;
    } catch {
      return false;
    }
  }

  async ensureCollection(name: string, dim: number): Promise<void> {
    try {
      const info = await this.req(`/collections/${name}`);
      const existingDim = info?.result?.config?.params?.vectors?.size;
      if (typeof existingDim === "number" && existingDim !== dim) {
        throw new Error(
          `Collection "${name}" exists with dim=${existingDim} but config requires dim=${dim}. Refusing to ingest.`,
        );
      }
      return;
    } catch (e: any) {
      if (!String(e).includes("404")) {
        // re-throw real errors (e.g. dim mismatch), only swallow not-found
        if (!String(e).includes("doesn't exist") && !String(e).includes("not found")) {
          // still might be "not found", be lenient on first call
        }
      }
    }
    await this.req(`/collections/${name}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: { size: dim, distance: "Cosine" },
      }),
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.req(`/collections/${name}`, { method: "DELETE" });
  }

  async upsert(collection: string, points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.req(`/collections/${collection}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    });
  }

  async deleteByFilter(collection: string, filter: Record<string, unknown>): Promise<void> {
    await this.req(`/collections/${collection}/points/delete?wait=true`, {
      method: "POST",
      body: JSON.stringify({ filter }),
    });
  }

  /**
   * Devuelve el payload de los primeros `limit` puntos que cumplen el filtro (sin vectores).
   * Sirve para consultar metadatos ya indexados —p. ej. el `file_hash` de un fichero— sin traer
   * los embeddings. Si la colección está vacía o no hay coincidencias, devuelve [].
   */
  async scrollPayloads(
    collection: string,
    filter: Record<string, unknown>,
    limit = 1,
  ): Promise<Record<string, unknown>[]> {
    const r = await this.req(`/collections/${collection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({ filter, limit, with_payload: true, with_vector: false }),
    });
    return ((r.result?.points ?? []) as { payload: Record<string, unknown> }[]).map((p) => p.payload);
  }

  async search(
    collection: string,
    vector: number[],
    limit: number,
  ): Promise<QdrantSearchResult[]> {
    const r = await this.req(`/collections/${collection}/points/search`, {
      method: "POST",
      body: JSON.stringify({ vector, limit, with_payload: true }),
    });
    return (r.result ?? []) as QdrantSearchResult[];
  }

  async searchMulti(
    collections: string[],
    vector: number[],
    limit: number,
  ): Promise<QdrantSearchResult[]> {
    const all = await Promise.all(
      collections.map(async (c) => {
        try {
          const results = await this.search(c, vector, limit);
          return results.map((r) => ({ ...r, payload: { ...r.payload, _collection: c } }));
        } catch {
          return [];
        }
      }),
    );
    return all.flat().sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
