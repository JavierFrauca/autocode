import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { log } from "../log.js";

let dir: string;
let prev: string | undefined;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "autocode-log-"));
  prev = process.env.AUTOCODE_LOG_DIR;
  process.env.AUTOCODE_LOG_DIR = dir;
});
afterAll(async () => {
  if (prev === undefined) delete process.env.AUTOCODE_LOG_DIR;
  else process.env.AUTOCODE_LOG_DIR = prev;
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("logger", () => {
  test("escribe al fichero con scope, mensaje y error serializado", async () => {
    log.warn("test.scope", "algo degradó", { err: new Error("boom"), n: 1 });
    const content = await fs.readFile(path.join(dir, "autocode.log"), "utf-8");
    expect(content).toContain("WARN");
    expect(content).toContain("[test.scope]");
    expect(content).toContain("algo degradó");
    expect(content).toContain("boom"); // el Error se serializa a {message}
  });
});
