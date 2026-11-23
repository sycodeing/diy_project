import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const templates = JSON.parse(await readFile(path.join(root, "src/lib/mockup-templates.json"), "utf8"));
const rendererFiles = ["api/mockup.py", "mockup-renderer/renderer.py", "mockup-renderer/app.py"];
const shared = await Promise.all(rendererFiles.map(async (file) => [file, await readFile(path.join(root, file))]));
const fingerprints = {};
for (const { id } of templates) {
  const dir = path.join(root, "mockup-renderer", "templates", id);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (!entries.length) continue;
  const hash = createHash("sha256");
  for (const [name, bytes] of shared) hash.update(name).update(bytes);
  for (const entry of entries.filter((item) => item.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(entry.name).update(await readFile(path.join(dir, entry.name)));
  }
  fingerprints[id] = hash.digest("hex");
}
await writeFile(path.join(root, "src/lib/account-template-fingerprints.json"), `${JSON.stringify(fingerprints, null, 2)}\n`);
