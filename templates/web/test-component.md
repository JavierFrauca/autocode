# Template: Test de un componente Vue

**tags:** test, vitest, vue, test-utils, jsdom

Requiere en el `package.json` de la app (devDependencies): `@vue/test-utils` y `jsdom`. Y un `vitest.config.ts` con entorno jsdom (ver al final).

```typescript
// tests/PedidoForm.test.ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PedidoForm from "../src/components/PedidoForm.vue";

describe("PedidoForm", () => {
  it("muestra un error si se envía vacío", async () => {
    const wrapper = mount(PedidoForm);
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.text()).toContain("obligatorio");
  });

  it("emite 'guardar' con los datos al enviar un formulario válido", async () => {
    const wrapper = mount(PedidoForm);
    await wrapper.find('input[name="cliente"]').setValue("Cliente 1");
    await wrapper.find("form").trigger("submit.prevent");

    const eventos = wrapper.emitted("guardar");
    expect(eventos).toBeTruthy();
    expect(eventos?.[0]?.[0]).toMatchObject({ cliente: "Cliente 1" });
  });
});
```

Configuración necesaria (`vitest.config.ts` en la raíz de la app):

```typescript
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: { environment: "jsdom", globals: false },
});
```

Notas:
- Prueba lo que el USUARIO ve y hace: texto en pantalla, eventos emitidos, estado de los campos. No el detalle interno del componente.
- Para componentes que llaman a la API, inyecta un doble del composable de datos (ver `templates/web/vue-api-composable`) en vez de pegar a la red.
