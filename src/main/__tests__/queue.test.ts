import { describe, expect, test } from "vitest";
import { EmbedBusyError, Mutex } from "../llm/queue.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("Mutex de la cola de embeddings", () => {
  test("serializa: solo uno corre a la vez, en orden FIFO", async () => {
    const m = new Mutex();
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;

    const job = async (id: number) => {
      const release = await m.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(id);
      await tick(5);
      active--;
      release();
    };

    await Promise.all([job(1), job(2), job(3)]);
    expect(maxActive).toBe(1);        // nunca dos a la vez
    expect(order).toEqual([1, 2, 3]); // FIFO
  });

  test("la adquisición con tope cede (EmbedBusyError) si la cola está ocupada", async () => {
    const m = new Mutex();
    const release = await m.acquire(); // ocupamos el lock y NO lo soltamos aún

    await expect(m.acquire(20)).rejects.toBeInstanceOf(EmbedBusyError);

    release(); // liberamos para no dejar el lock colgado
  });

  test("tras ceder por timeout, el siguiente sin tope obtiene el turno al liberar", async () => {
    const m = new Mutex();
    const release = await m.acquire();

    const interactive = m.acquire(10).catch((e) => e); // cederá
    const background = m.acquire().then((rel) => { rel(); return "ok"; }); // espera su turno

    await tick(30);
    release();

    expect(await interactive).toBeInstanceOf(EmbedBusyError);
    expect(await background).toBe("ok");
  });

  test("un waiter que cede no rompe la cadena para los siguientes", async () => {
    const m = new Mutex();
    const release = await m.acquire();
    const got: string[] = [];

    const a = m.acquire(10).then((rel) => { got.push("a"); rel(); }).catch(() => { got.push("a-ceded"); });
    const b = m.acquire().then((rel) => { got.push("b"); rel(); });

    await tick(30); // 'a' cede por timeout
    release();      // el lock pasa a 'b'
    await Promise.all([a, b]);

    expect(got).toContain("a-ceded");
    expect(got).toContain("b");
  });
});
