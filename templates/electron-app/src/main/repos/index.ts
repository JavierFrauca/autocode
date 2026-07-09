import { type ItemsRepo, ItemsRepoSqlite } from "./items.repo.js";

/**
 * COMPOSITION ROOT de la persistencia. Toda la app accede a la BD a través de estos repositorios
 * (puertos), nunca con SQL suelto. El agente añade aquí una entrada por cada entidad del dominio.
 */
export interface Repos {
  items: ItemsRepo;
}

export const repos: Repos = {
  items: new ItemsRepoSqlite(),
};
