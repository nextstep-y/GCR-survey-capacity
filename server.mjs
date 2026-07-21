import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const spreadsheetId =
  process.env.GCR_SHEET_ID || "1ZaIHyL6iMFXmlYQoZHfQNdVRFU6Jy83dYgYqyASt3Q4";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

async function proxySheet(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sheet = url.searchParams.get("sheet");
  if (!sheet || !/^[\w\s_-]+$/.test(sheet)) {
    send(res, 400, JSON.stringify({ error: "Invalid sheet name" }), {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  const source = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`,
  );
  source.searchParams.set("tqx", "out:csv");
  source.searchParams.set("sheet", sheet);

  try {
    const response = await fetch(source);
    if (!response.ok) {
      send(
        res,
        response.status,
        JSON.stringify({ error: `Google Sheet responded ${response.status}` }),
        { "Content-Type": "application/json; charset=utf-8" },
      );
      return;
    }
    const body = await response.text();
    send(res, 200, body, { "Content-Type": "text/csv; charset=utf-8" });
  } catch (error) {
    send(
      res,
      502,
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(__dirname, requested));
  if (!filePath.startsWith(__dirname)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  try {
    const body = await readFile(filePath);
    send(res, 200, body, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    });
  } catch {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    send(res, 204, "");
    return;
  }
  if (req.url?.startsWith("/api/sheet")) {
    void proxySheet(req, res);
    return;
  }
  void serveStatic(req, res);
}).listen(port, () => {
  console.log(`GCR dashboard running at http://localhost:${port}`);
});
