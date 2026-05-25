import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
};

// Vercel rewrites from vercel.json
const REWRITES = {
  "/dashboard":   "/pages/dashboard.html",
  "/repositories":"/pages/repositories.html",
  "/repository":  "/pages/repository.html",
  "/auth-complete":"/pages/auth-complete.html",
};

async function handleApi(req, res, urlPath) {
  // map /api/auth/me  →  api/auth/me.js
  // map /api/auth/session/abc  →  api/auth/session/[id].js
  let rel = urlPath.slice(1); // strip leading /
  let modulePath = path.join(root, rel + ".js");

  if (!fs.existsSync(modulePath)) {
    // try dynamic segment: find a [param].js sibling
    const parts = rel.split("/");
    const parent = parts.slice(0, -1).join("/");
    const parentDir = path.join(root, parent);
    if (fs.existsSync(parentDir)) {
      const dynamic = fs.readdirSync(parentDir).find(f => f.startsWith("[") && f.endsWith("].js"));
      if (dynamic) {
        const paramName = dynamic.slice(1, -4); // strip [ and ].js
        modulePath = path.join(parentDir, dynamic);
        // inject into query
        const u = new URL("http://localhost" + req.url);
        u.searchParams.set(paramName, parts[parts.length - 1]);
        req.url = u.pathname + "?" + u.searchParams.toString();
      }
    }
  }

  if (!fs.existsSync(modulePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "API route not found" }));
    return;
  }

  try {
    const mod = await import(pathToFileURL(modulePath).href + "?t=" + Date.now());
    // Parse body
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      await new Promise((resolve) => {
        let body = "";
        req.on("data", c => body += c);
        req.on("end", () => {
          try { req.body = JSON.parse(body); } catch { req.body = {}; }
          resolve();
        });
      });
    }
    // Simple res wrapper to match Vercel's interface
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
    // Parse cookies
    req.cookies = Object.fromEntries(
      (req.headers.cookie || "").split(";").filter(Boolean).map(c => {
        const [k, ...v] = c.trim().split("=");
        return [k.trim(), decodeURIComponent(v.join("="))];
      })
    );
    await mod.default(req, res);
  } catch (err) {
    console.error(`API error [${urlPath}]:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL("http://localhost" + req.url).pathname;

  // API routes
  if (urlPath.startsWith("/api/")) {
    return handleApi(req, res, urlPath);
  }

  // Rewrites
  const rewritten = REWRITES[urlPath];
  if (rewritten) {
    const filePath = path.join(root, "public", rewritten);
    if (fs.existsSync(filePath)) return serveStatic(res, filePath);
  }

  // Static files
  let filePath = path.join(root, "public", urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (fs.existsSync(filePath)) return serveStatic(res, filePath);

  // 404
  const notFound = path.join(root, "public", "pages", "404.html");
  if (fs.existsSync(notFound)) {
    res.writeHead(404, { "Content-Type": "text/html" });
    fs.createReadStream(notFound).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Julion dev server running at http://localhost:${PORT}`);
});
