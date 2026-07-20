import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "dist");
const dst = path.join(here, "..", "..", "deploy", "frontend-dist");
if (!fs.existsSync(src)) {
  console.error("Missing frontend/dist — run vite build first");
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log("synced", dst);
