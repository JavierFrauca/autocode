# Template: tsconfig.json de Electron (uno solo, compatible con el gate de QA)

**tags:** electron, tsconfig, typescript, dom, lib, compileroptions, vue
**transversal:** true
**Cuándo usar:** raíz de toda app Electron. **UN solo `tsconfig.json`** (el gate de QA corre `tsc --noEmit -p tsconfig.json`, así que evitamos los project-references que no typechean con ese comando). Lleva `dom` para el renderer y `node` para el main. La clave: sin `"lib": ["DOM"]` salen cientos de `Cannot find name 'document'/'window'/HTMLElement'`.

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/renderer/src/*"] }
  },
  "include": ["src/**/*", "src/**/*.vue", "electron.vite.config.ts"]
}
```

`src/renderer/src/shims-vue.d.ts` (OBLIGATORIO para que `import App from "./App.vue"` compile con `tsc`):
```typescript
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
```

## Reglas de oro
- **`"lib": ["ES2022", "DOM", "DOM.Iterable"]`** → da `document`, `window`, `HTMLElement`, `alert`, `DragEvent`, `FileReader`, etc. al renderer. (El main, que es Node, también lo recibe, pero es inofensivo: nunca usa esas globales.)
- **`"types": ["node"]`** → `__dirname`, `process`, `Buffer`, etc. en el main.
- **El shim `*.vue` es imprescindible**: sin él, importar un componente Vue da `Cannot find module './App.vue'`. (Ojo: `tsc` NO mira DENTRO del `<script>` de los `.vue` — eso necesitaría `vue-tsc`; el gate actual typechea los `.ts`.)
- `moduleResolution: "Bundler"` + `module: "ESNext"`: lo que espera electron-vite. No uses `CommonJS` en el source.
- `skipLibCheck: true`: evita que los `.d.ts` de dependencias rompan el typecheck.
- Un solo `tsconfig.json` (sin `references`) para que `tsc --noEmit -p tsconfig.json` (el comando del gate) typechee TODO. electron-vite funciona igual con un solo tsconfig.
