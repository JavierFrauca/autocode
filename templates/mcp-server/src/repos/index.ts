import { type ItemsRepo, ItemsRepoSqlite } from "./items.repo.js";

/**
 * COMPOSITION ROOT de la persistencia OPCIONAL (ver db.ts). El agente añade aquí una entrada por cada
 * "cosa" que el servidor necesite recordar entre llamadas.
 */
export interface Repos {
  items: ItemsRepo;
}

export const repos: Repos = {
  items: new ItemsRepoSqlite(),
};
