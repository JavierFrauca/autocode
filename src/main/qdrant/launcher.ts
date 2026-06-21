import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const QDRANT_VERSION = "v1.12.4";

interface PlatformAsset {
  asset: string;
  kind: "zip" | "tar.gz";
  binName: string;
}

function platformAsset(): PlatformAsset {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  switch (process.platform) {
    case "win32":
      return { asset: "qdrant-x86_64-pc-windows-msvc.zip", kind: "zip", binName: "qdrant.exe" };
    case "linux":
      return { asset: `qdrant-${arch}-unknown-linux-gnu.tar.gz`, kind: "tar.gz", binName: "qdrant" };
    case "darwin":
      return { asset: `qdrant-${arch}-apple-darwin.tar.gz`, kind: "tar.gz", binName: "qdrant" };
    default:
      throw new Error(`Plataforma no soportada para Qdrant auto-launcher: ${process.platform}`);
  }
}

export function qdrantDir(): string {
  if (process.env.AUTOCODE_QDRANT_DIR) return path.resolve(process.env.AUTOCODE_QDRANT_DIR);
  return path.resolve(process.cwd(), ".autocode-qdrant");
}

function qdrantPort(): number {
  const url = process.env.QDRANT_URL ?? "http://127.0.0.1:6333";
  try {
    return Number(new URL(url).port || "6333");
  } catch {
    return 6333;
  }
}

async function alreadyRunning(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/readyz`);
    return r.ok;
  } catch {
    return false;
  }
}

async function downloadAndExtract(target: string, asset: string, kind: "zip" | "tar.gz"): Promise<void> {
  const url = `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/${asset}`;
  console.log(`[qdrant] descargando ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Descarga Qdrant falló: ${res.status}`);
  const archivePath = path.join(target, asset);
  await pipeline(res.body as any, createWriteStream(archivePath));

  if (kind === "zip") {
    const AdmZip = (await import("adm-zip")).default;
    new AdmZip(archivePath).extractAllTo(target, true);
  } else {
    const tar = await import("tar");
    await tar.x({ file: archivePath, cwd: target });
  }
  await fs.unlink(archivePath).catch(() => {});
}

async function ensureBinary(): Promise<string> {
  const dir = qdrantDir();
  await fs.mkdir(dir, { recursive: true });
  const { asset, kind, binName } = platformAsset();
  const binPath = path.join(dir, binName);
  try {
    await fs.access(binPath);
    return binPath;
  } catch {
    // not present; download
  }
  await downloadAndExtract(dir, asset, kind);
  if (process.platform !== "win32") {
    await fs.chmod(binPath, 0o755).catch(() => {});
  }
  return binPath;
}

let proc: ChildProcess | null = null;
let shuttingDown = false;

export async function startQdrant(): Promise<void> {
  const port = qdrantPort();
  if (await alreadyRunning(port)) {
    console.log(`[qdrant] ya hay una instancia en ${port}`);
    return;
  }
  const binPath = await ensureBinary();
  const storage = path.join(qdrantDir(), "storage");
  await fs.mkdir(storage, { recursive: true });

  proc = spawn(binPath, [], {
    env: {
      ...process.env,
      QDRANT__SERVICE__HTTP_PORT: String(port),
      QDRANT__STORAGE__STORAGE_PATH: storage,
      QDRANT__TELEMETRY_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", () => { /* drop */ });
  proc.stderr?.on("data", () => { /* drop */ });
  proc.on("exit", (code) => {
    proc = null;
    if (!shuttingDown) console.warn(`[qdrant] proceso terminó con code=${code}`);
  });

  for (let i = 0; i < 40; i++) {
    if (await alreadyRunning(port)) {
      console.log(`[qdrant] arriba en ${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopQdrant();
  throw new Error("[qdrant] no respondió en 20s tras arrancar");
}

export function stopQdrant(): void {
  shuttingDown = true;
  if (proc && !proc.killed) {
    try { proc.kill(); } catch {}
  }
  proc = null;
}

export function installShutdownHooks(): void {
  const exit = () => { stopQdrant(); process.exit(0); };
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
  process.on("beforeExit", () => stopQdrant());
}
