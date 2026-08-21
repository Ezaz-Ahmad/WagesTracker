import { createServer, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const DIST_ROOT = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function send(response: ServerResponse, status: number, body: Buffer, path: string): void {
  response.writeHead(status, {
    "Content-Type": MIME_TYPES[extname(path)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const assetPath = resolve(DIST_ROOT, relativePath);

    if (assetPath !== DIST_ROOT && !assetPath.startsWith(`${DIST_ROOT}${sep}`)) {
      response.writeHead(400).end("Bad request");
      return;
    }

    try {
      send(response, 200, await readFile(assetPath), assetPath);
    } catch {
      // Vercel's rewrite serves index.html for client-side routes; mirror it.
      const indexPath = resolve(DIST_ROOT, "index.html");
      send(response, 200, await readFile(indexPath), indexPath);
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(4173, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  return () => new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}
