/* Onshape → glTF (GLB) export helper.
 *
 * Shared by the local dev server (../server.mjs) and the Cloudflare Worker
 * (worker.js). Onshape requires every API request to be authenticated, so the
 * API key pair stays here, on the server; the browser only ever receives the
 * exported model.
 */

const API_VERSION = "v11";
const DEFAULT_MAX_BYTES = 60 * 1024 * 1024;

export class OnshapeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OnshapeError";
    this.status = status || 502;
  }
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function basicAuth(accessKey, secretKey) {
  const pair = String(accessKey) + ":" + String(secretKey);
  if (typeof btoa === "function") return "Basic " + btoa(pair);
  return "Basic " + Buffer.from(pair, "utf8").toString("base64");
}

/* Pull document/workspace/version/microversion/element ids out of a regular
 * Onshape URL: https://cad.onshape.com/documents/<did>/w|v|m/<id>/e/<eid> */
export function parseOnshapeLink(input, extraHosts) {
  const raw = String(input || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new OnshapeError(
      "That is not a URL. Paste the full Onshape link from the browser address bar.",
      400
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OnshapeError("Only http(s) Onshape links are supported.", 400);
  }

  const allowedHosts = (extraHosts || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  const isOnshape = /(^|\.)onshape\.com$/.test(host);
  if (!isOnshape && !allowedHosts.includes(host)) {
    throw new OnshapeError("Only Onshape document links can be exported.", 400);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const docIndex = segments.indexOf("documents");
  if (docIndex === -1) {
    throw new OnshapeError(
      "This is not a document link. Open the Part Studio or Assembly tab in Onshape and copy the URL from the address bar.",
      400
    );
  }

  const did = segments[docIndex + 1];
  let wvm = null;
  let wvmid = null;
  let eid = null;
  for (let i = docIndex + 2; i < segments.length - 1; i++) {
    const key = segments[i];
    if (!wvmid && (key === "w" || key === "v" || key === "m")) {
      wvm = key;
      wvmid = segments[i + 1];
    } else if (key === "e") {
      eid = segments[i + 1];
    }
  }

  if (!did || !wvm || !wvmid) {
    throw new OnshapeError(
      "This link points at a document, not at a tab. Open the Part Studio or Assembly you want and copy its URL.",
      400
    );
  }
  if (!eid) {
    throw new OnshapeError(
      "This link is missing the tab id (the part after /e/). Open the Part Studio or Assembly and copy the URL.",
      400
    );
  }

  return { origin: url.origin, did, wvm, wvmid, eid };
}

async function httpError(response, context) {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      detail = json.message || json.error || json.name || "";
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  detail = String(detail || "").replace(/\s+/g, " ").slice(0, 240);

  const hint =
    response.status === 401 || response.status === 403
      ? "Check that the API key is valid and its user can open this document."
      : "";

  return new OnshapeError(
    [context, detail, hint].filter(Boolean).join(" — "),
    response.status
  );
}

async function readElement(ids, auth) {
  const url =
    `${ids.origin}/api/${API_VERSION}/documents/d/${ids.did}/${ids.wvm}/${ids.wvmid}/elements` +
    `?elementId=${encodeURIComponent(ids.eid)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: "application/json;charset=UTF-8; qs=0.09"
    }
  });
  if (!response.ok) throw await httpError(response, "Could not read this Onshape document");

  const list = await response.json();
  const element = (Array.isArray(list) ? list : []).find(
    (entry) => entry.id === ids.eid || entry.elementId === ids.eid
  );
  if (!element) {
    throw new OnshapeError(
      "That tab was not found in the document, or the API key's user cannot see it.",
      404
    );
  }
  return {
    type: String(element.elementType || "").toUpperCase(),
    name: element.name || "model"
  };
}

async function readGltf(response, maxBytes) {
  if (!response.ok) throw await httpError(response, "Onshape could not export this model");

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new OnshapeError(
      `This model is ${megabytes(declared)}, which is too large to render here. Export it at a lower resolution or link a smaller tab.`,
      413
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) {
    throw new OnshapeError("Onshape returned an empty export.", 502);
  }
  if (bytes.length > maxBytes) {
    throw new OnshapeError(
      `This model is ${megabytes(bytes.length)}, which is too large to render here. Export it at a lower resolution.`,
      413
    );
  }

  // GLB: "glTF" magic.
  if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
    return { bytes, contentType: "model/gltf-binary", extension: "glb" };
  }

  const text = new TextDecoder().decode(bytes);
  if (text.trimStart().startsWith("{")) {
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* fall through */
    }
    if (json && json.asset) {
      const external = (json.buffers || []).some(
        (buffer) => buffer.uri && !String(buffer.uri).startsWith("data:")
      );
      if (external) {
        throw new OnshapeError(
          "Onshape returned a glTF that references external files; the browser cannot fetch those. Use the GLB (binary) export instead.",
          502
        );
      }
      return { bytes, contentType: "model/gltf+json", extension: "gltf" };
    }
    const message = json && (json.message || json.error || json.name);
    throw new OnshapeError(
      message ? "Onshape: " + message : "Onshape returned an error instead of a model.",
      502
    );
  }

  const type = (response.headers.get("content-type") || "unknown type").toLowerCase();
  throw new OnshapeError("Onshape returned an unexpected file (" + type + ").", 502);
}

/* Follows Onshape's 307 download redirect. Storage URLs are pre-signed, so the
 * API Authorization header must not be forwarded cross-host. */
async function fetchFollowingRedirect(url, auth, origin, accept) {
  const response = await fetch(url, {
    headers: { Authorization: auth, Accept: accept },
    redirect: "manual"
  });
  if (!isRedirect(response.status)) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  const target = new URL(location, origin);
  const sameHost = target.hostname === new URL(origin).hostname;
  const headers = sameHost
    ? { Authorization: auth, Accept: accept }
    : { Accept: accept };

  let followed = await fetch(target, { headers });
  if (!followed.ok && !sameHost) {
    followed = await fetch(target, { headers: { Authorization: auth, Accept: accept } });
  }
  return followed;
}

async function syncExport(ids, auth, kind, maxBytes) {
  const url =
    `${ids.origin}/api/${API_VERSION}/${kind}/d/${ids.did}/${ids.wvm}/${ids.wvmid}/e/${ids.eid}/gltf` +
    "?outputFaceAppearances=true";
  const response = await fetchFollowingRedirect(
    url,
    auth,
    ids.origin,
    "model/gltf-binary, model/gltf+json;q=0.9, application/json;q=0.5, */*;q=0.1"
  );
  return readGltf(response, maxBytes);
}

async function asyncExport(ids, auth, kind, maxBytes) {
  if (ids.wvm === "m") {
    throw new OnshapeError(
      "Microversion links cannot be exported this way. Open the workspace version of the tab and use that link.",
      400
    );
  }

  const base = `${ids.origin}/api/${API_VERSION}/${kind}/d/${ids.did}/${ids.wvm}/${ids.wvmid}/e/${ids.eid}`;
  let response = await fetch(base + "/export/gltf", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09"
    },
    body: JSON.stringify({
      meshParams: { resolution: "MEDIUM", unit: "METER" },
      storeInDocument: false
    })
  });
  if (!response.ok) throw await httpError(response, "Onshape could not start the export");

  const job = await response.json();
  const id = job.id;
  if (!id) throw new OnshapeError("Onshape did not return an export id.", 502);

  let state = job;
  for (let attempt = 0; attempt < 30 && state.requestState !== "DONE"; attempt++) {
    if (state.requestState === "FAILED") {
      throw new OnshapeError(
        "Onshape export failed: " + (state.failureReason || "unknown reason"),
        502
      );
    }
    await sleep(1200);
    const poll = await fetch(`${ids.origin}/api/${API_VERSION}/translations/${id}`, {
      headers: { Authorization: auth, Accept: "application/json" }
    });
    if (!poll.ok) throw await httpError(poll, "Could not check the export status");
    state = await poll.json();
  }

  if (state.requestState !== "DONE") {
    throw new OnshapeError("Onshape took too long to export this model.", 504);
  }

  const externalId = (state.resultExternalDataIds || [])[0];
  if (externalId) {
    const download = await fetchFollowingRedirect(
      `${ids.origin}/api/${API_VERSION}/documents/d/${ids.did}/externaldata/${externalId}`,
      auth,
      ids.origin,
      "*/*"
    );
    return readGltf(download, maxBytes);
  }

  const elementId = (state.resultElementIds || [])[0];
  if (!elementId) throw new OnshapeError("Onshape finished the export but returned no file.", 502);

  const workspaceId = state.resultWorkspaceId || ids.wvmid;
  const download = await fetchFollowingRedirect(
    `${ids.origin}/api/${API_VERSION}/blobelements/d/${ids.did}/w/${workspaceId}/e/${elementId}`,
    auth,
    ids.origin,
    "*/*"
  );
  return readGltf(download, maxBytes);
}

/* Export the tab behind an Onshape link to a browser-ready glTF/GLB buffer.
 * `outputFaceAppearances` keeps part and face colours from Onshape. */
export async function exportOnshapeGltf({
  docUrl,
  accessKey,
  secretKey,
  maxBytes = DEFAULT_MAX_BYTES,
  extraHosts
}) {
  if (!accessKey || !secretKey) {
    throw new OnshapeError(
      "The Onshape proxy has no API key. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY on the server.",
      500
    );
  }

  const ids = parseOnshapeLink(docUrl, extraHosts);
  const auth = basicAuth(accessKey, secretKey);
  const element = await readElement(ids, auth);

  if (element.type === "PARTSTUDIO") {
    return syncExport(ids, auth, "partstudios", maxBytes);
  }

  if (element.type === "ASSEMBLY" || element.type === "SUBASSEMBLY") {
    try {
      return await syncExport(ids, auth, "assemblies", maxBytes);
    } catch (error) {
      // Older deployments miss the synchronous assembly endpoint; fall back.
      if (error instanceof OnshapeError && (error.status === 404 || error.status === 405)) {
        return asyncExport(ids, auth, "assemblies", maxBytes);
      }
      throw error;
    }
  }

  throw new OnshapeError(
    `The linked tab is a ${element.type || "non-3D"} element. Link a Part Studio or an Assembly.`,
    400
  );
}
