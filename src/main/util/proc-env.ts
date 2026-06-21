/**
 * Entorno saneado para procesos hijos que operan sobre la APP GENERADA (`_app/`): `npm run dev`/build,
 * arrancar el servidor, instalar deps, empaquetar, tests…
 *
 * EL BUG que evita (causa real, verificada): cuando AutoCode se ejecuta desde el source con `npm run
 * dev`, su proceso tiene `ELECTRON_RENDERER_URL` apuntando al servidor Vite DE AUTOCODE. El andamiaje
 * de las apps de escritorio carga ese mismo `process.env.ELECTRON_RENDERER_URL` si existe (es el patrón
 * estándar de electron-vite). Si el hijo lo hereda, la ventana de la app GENERADA cargaba la UI de
 * AUTOCODE (síntoma real: "doy a Probar y se abre AutoCode"). Quitándolo, el electron-vite hijo pone su
 * propia URL (o, si no, el main cae a su `loadFile` local) → nunca carga AutoCode. Fix airtight.
 *
 * Además se quitan, por higiene, variables del contexto de ejecución de AutoCode que no deben filtrarse
 * al hijo: `ELECTRON_RUN_AS_NODE` (AutoCode lo usa para correr tsc/vitest como node; no debe forzar
 * modo-node en el Electron de la app) y las `npm_*` / `INIT_CWD` (estado del `npm run` de AutoCode; el
 * npm hijo recalcula el suyo desde su `cwd`). Quien necesite alguna la repone vía `extra`.
 */
export function childEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "ELECTRON_RENDERER_URL") continue; // ← la causa: URL del renderer de AutoCode en dev
    if (k === "ELECTRON_RUN_AS_NODE") continue; // no forzar node en el Electron hijo
    if (k.startsWith("npm_")) continue; // npm_config_*, npm_lifecycle_*, npm_package_* (higiene)
    if (k === "INIT_CWD") continue; // cwd original de npm (repo de AutoCode) (higiene)
    env[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
  return env;
}
