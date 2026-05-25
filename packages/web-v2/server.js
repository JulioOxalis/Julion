// Production server for DirectAdmin / Passenger hosting
// Serves static files from public/ and routes /api/* to serverless handlers

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
};

const REWRITES = {
  "/dashboard":    "/pages/dashboard.html",
  "/repositories": "/pages/repositories.html",
  "/repository":   "/pages/repository.html",
  "/auth-complete":"/pages/auth-complete.html",
};

// Cache API modules in production
const moduleCache = new Map();

async function loadApiModule(modulePath) {
  if (process.env.NODE_ENV === "production" && moduleCache.has(modulePath)) {
    return moduleCache.get(modulePath);
  }
  const mod = await import(pathToFileURL(modulePath).href + (process.env.NODE_ENV !== "production" ? "?t=" + Date.now() : ""));
  if (process.env.NODE_ENV === "production") moduleCache.set(modulePath, mod);
  return mod;
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return resolve();
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try { req.body = JSON.parse(body); } catch { req.body = {}; }
      resolve();
    });
  });
}

function parseCookies(req) {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || "").split(";").filter(Boolean).map(c => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), decodeURIComponent(v.join("="))];
    })
  );
}

function wrapResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };
  res.send = (data) => res.end(data);
  res.redirect = (url) => {
    res.writeHead(302, { Location: url });
    res.end();
  };
}

async function handleApi(req, res, urlPath) {
  let rel = urlPath.slice(1);
  let modulePath = path.join(__dirname, rel + ".js");
  const query = new URL("http://localhost" + req.url);

  if (!fs.existsSync(modulePath)) {
    const parts = rel.split("/");
    const parentDir = path.join(__dirname, parts.slice(0, -1).join("/"));
    if (fs.existsSync(parentDir)) {
      const dynamic = fs.readdirSync(parentDir).find(f => /^\[.+\]\.js$/.test(f));
      if (dynamic) {
        const paramName = dynamic.slice(1, dynamic.indexOf("]"));
        query.searchParams.set(paramName, parts[parts.length - 1]);
        req.url = query.pathname + "?" + query.searchParams.toString();
        modulePath = path.join(parentDir, dynamic);
      }
    }
  }

  if (!fs.existsSync(modulePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "API route not found" }));
    return;
  }

  try {
    parseCookies(req);
    wrapResponse(res);
    await parseBody(req);
    const mod = await loadApiModule(modulePath);
    await mod.default(req, res);
  } catch (err) {
    console.error(`[API] ${urlPath}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL("http://localhost" + req.url).pathname;

  if (urlPath.startsWith("/api/")) {
    return handleApi(req, res, urlPath);
  }

  const rewritten = REWRITES[urlPath];
  const candidate = rewritten
    ? path.join(__dirname, "public", rewritten)
    : path.join(__dirname, "public", urlPath);

  let filePath = candidate;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(res, filePath);
  }

  const notFound = path.join(__dirname, "public", "pages", "404.html");
  if (fs.existsSync(notFound)) {
    res.writeHead(404, { "Content-Type": "text/html" });
    fs.createReadStream(notFound).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Julion running on port ${PORT}`);
});

export default server;
