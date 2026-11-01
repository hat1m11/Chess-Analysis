// Builds dist/: everything a static host needs, with only the vendor files the page loads.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const VENDOR_FILES = [
  "chess.js/dist/esm/chess.js",
  "chess.js/LICENSE",
  "chessground/assets/chessground.cburnett.css",
  "chessground/LICENSE",
  "stockfish/bin/stockfish-19-lite-single.js",
  "stockfish/bin/stockfish-19-lite-single.wasm",
  "stockfish/Copying.txt",
  "@fontsource/geist-sans/latin-400.css",
  "@fontsource/geist-sans/latin-500.css",
  "@fontsource/geist-sans/latin-600.css",
  "@fontsource/geist-sans/LICENSE",
];

const copyVendor = (file) => {
  const target = join(DIST, "vendor", file);
  mkdirSync(join(target, ".."), { recursive: true });
  cpSync(join(ROOT, "node_modules", file), target);
};

rmSync(DIST, { recursive: true, force: true });
cpSync(join(ROOT, "public"), DIST, { recursive: true });
cpSync(join(ROOT, "src"), join(DIST, "src"), { recursive: true });
VENDOR_FILES.forEach(copyVendor);
readdirSync(join(ROOT, "node_modules/@fontsource/geist-sans/files"))
  .filter((name) => /^geist-sans-latin-(400|500|600)-normal\.woff2?$/.test(name))
  .forEach((name) => copyVendor(`@fontsource/geist-sans/files/${name}`));

console.log(`Built ${DIST}`);
