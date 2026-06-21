# Template: tsconfig.json para Servidor (Node, sin dom)

**tags:** server, tsconfig, typescript, node, nodenext
**transversal:** true
**Cuándo usar:** raíz de toda app servidor. Es **Node puro** → NO lleva `dom` (no hay `window`/`document` en un backend). Compatible con el gate (`tsc --noEmit -p tsconfig.json`).

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

## Reglas de oro
- **Sin `dom`**: es un backend. Si necesitas `fetch`, en Node 18+ es global (no requiere `dom`). NO añadas `"DOM"` o tendrás globales del navegador que no existen en runtime.
- **`module`/`moduleResolution`: `NodeNext`** → ESM nativo de Node. Obliga a poner extensión `.js` en los imports relativos (`from "./x.js"`). Es lo que espera `tsc` al compilar a `dist/`.
- `"types": ["node"]` → `process`, `Buffer`, etc.
- `outDir: "dist"` + `rootDir: "src"` → `tsc` emite el build a `dist/` (lo que ejecuta `node dist/server.js`).
- `skipLibCheck: true` para que los `.d.ts` de dependencias no rompan el typecheck.
