/* Cloudflare Worker: exposes the Onshape → GLB export for the website.
 *
 *   GET /gltf?url=<onshape document link>
 *
 * Secrets (never in the browser):
 *   wrangler secret put ONSHAPE_ACCESS_KEY
 *   wrangler secret put ONSHAPE_SECRET_KEY
 *
 * Variables (wrangler.toml):
 *   ALLOWED_ORIGINS  comma-separated site origins, e.g.
 *                    "https://robotictechfrox.github.io"
 *   ONSHAPE_HOSTS    optional extra CAD hosts for enterprise domains
 */

import { exportOnshapeGltf, OnshapeError } from "./proxy.mjs";

const MAX_CACHE_BYTES = 25 * 1024 * 1024;
const MAX_BYTES = 60 * 1024 * 1024;

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (!origin) return headers;

  if (allowed.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }
  if (allowed.includes(origin) || isLocalOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowed.includes("*") || allowed.includes(origin) || isLocalOrigin(origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    if (url.pathname !== "/" && url.pathname !== "/gltf") {
      return json({ error: "Not found" }, 404, cors);
    }
    if (!originAllowed(request, env)) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    const docUrl = url.searchParams.get("url");
    if (!docUrl) {
      return json({ error: "Missing ?url=<onshape document link>" }, 400, cors);
    }

    if (!env.ONSHAPE_ACCESS_KEY || !env.ONSHAPE_SECRET_KEY) {
      return json(
        {
          error:
            "This proxy has no Onshape API key. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY with `wrangler secret put`."
        },
        500,
        cors
      );
    }

    const extraHosts = String(env.ONSHAPE_HOSTS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    // Cache the exported bytes, but rebuild headers per request so CORS still
    // reflects the calling origin.
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const bytes = await hit.arrayBuffer();
          return new Response(bytes, {
            headers: {
              ...cors,
              "Content-Type": hit.headers.get("Content-Type") || "model/gltf-binary",
              "Cache-Control": "public, max-age=3600"
            }
          });
        }
      } catch {
        /* cache is best-effort */
      }
    }

    try {
      const result = await exportOnshapeGltf({
        docUrl,
        accessKey: env.ONSHAPE_ACCESS_KEY,
        secretKey: env.ONSHAPE_SECRET_KEY,
        maxBytes: MAX_BYTES,
        extraHosts
      });

      if (cache && result.bytes.length <= MAX_CACHE_BYTES) {
        const cacheHeaders = {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=3600"
        };
        ctx.waitUntil(
          cache.put(cacheKey, new Response(result.bytes.slice(), { headers: cacheHeaders }))
        );
      }

      return new Response(result.bytes, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": result.contentType,
          "Content-Disposition": 'inline; filename="onshape-model.' + result.extension + '"',
          "Cache-Control": "public, max-age=3600"
        }
      });
    } catch (error) {
      const status = error instanceof OnshapeError ? error.status : 502;
      const message = error && error.message ? error.message : "Onshape export failed";
      if (windowlessConsole()) console.error("[onshape]", message);
      return json({ error: message }, status, cors);
    }
  }
};

function windowlessConsole() {
  return typeof console !== "undefined" && console.error;
}
