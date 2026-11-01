// Minimal static file server: "/" maps to public/, "/src/" to src/, "/vendor/" to node_modules/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolvePath(pathname) {
  if (pathname.startsWith("/vendor/")) {
    const baseDir = resolve(ROOT, "node_modules");
    const filePath = resolve(join(baseDir, `.${pathname.slice("/vendor".length)}`));
    return filePath.startsWith(baseDir + sep) ? filePath : null;
  }
  const baseDir = resolve(ROOT, pathname.startsWith("/src/") ? "." : "public");
  const allowedDir = pathname.startsWith("/src/") ? resolve(ROOT, "src") : baseDir;
  const filePath = resolve(join(baseDir, pathname === "/" ? "index.html" : `.${pathname}`));
  return filePath.startsWith(allowedDir + sep) ? filePath : null;
}

createServer(async (req, res) => {
  try {
    const filePath = resolvePath(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!filePath) throw new Error("Path outside the served folders");
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Chess review running at http://localhost:${PORT}`);
});
