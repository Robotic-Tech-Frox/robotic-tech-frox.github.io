# Onshape → 3D hero

The hero panel on `index.html` renders a glTF/GLB model. It tries these sources
in order:

| Source | How |
|---|---|
| Onshape link | `index.html?onshape=<onshape URL>` |
| Any GLB URL | `index.html?model=<url>` |
| Committed export | `assets/models/bot.glb` body + `assets/models/bot-labels.glb` full-res label overlay |
| Nothing available | procedural placeholder robot already in the scene |

The model is auto-centred, scaled and framed, and its glTF materials are left
alone — so the colours you set in Onshape are what the site shows.

---

## 1. Put the real bot on the site (recommended)

No API key, no server, works on GitHub Pages.

1. Open the **Assembly** (or Part Studio) tab in Onshape.
2. Right-click the tab → **Export…**
3. Format: **GLB**. Resolution: **Medium** (Fine is usually unnecessary for a
   hero and can be tens of MB). “Compress” is optional — the loader supports
   Draco-compressed exports.
4. Tick the appearance/colour option if Onshape offers it for your export.
5. Save the export locally as `assets/models/bot.source.glb`, run the pipeline
   below, then commit `bot.glb` and `bot-labels.glb` (not the source file).

Refresh the page and the placeholder is replaced. The committed body and label
overlay together are ~2.2 MB; keep them under ~10 MB so the hero stays quick.
GitHub rejects files over 100 MB.

### Shrinking the export (do this)

Onshape exports the whole assembly at full CAD tessellation: a detailed robot
can reach 250 MB and 150M+ rendered vertices, which freezes the browser no
matter how well the page is written. “Coarse” only changes tessellation slightly.
The committed hero is split into two files:

| File | Size | Purpose |
|---|---|---|
| `assets/models/bot.glb` | ~2.0 MB | body: 376k triangles, ~100 draw calls |
| `assets/models/bot-labels.glb` | ~185 KB | full-resolution plates/labels: 50k triangles |

Why: the “37548” lettering is tiny compared with the 8.4M-triangle chassis. Any
global simplification strong enough for a smooth hero melts it. The body is
therefore simplified hard, while the original label meshes are kept untouched
and drawn as a small overlay. The page loads both files in parallel.

The pipeline that produced the committed files (250 MB source → 2.0 MB body +
185 KB labels, 426k total triangles, 107 draw calls):

```bash
mv assets/models/bot.glb assets/models/bot.source.glb   # keep the original locally

# 1. Simplify the body and compress it for transfer.
#    --palette false keeps the 52 real materials: merging them into a palette
#    texture remaps CAD colours and is not needed for this model.
npx -y @gltf-transform/cli@4 optimize \
  assets/models/bot.source.glb assets/models/bot.optimized.glb \
  --compress meshopt --simplify true \
  --simplify-ratio 0.05 --simplify-error 0.005 --palette false

# 2. Decompress and dequantize so the final packer quantizes only once.
npx -y @gltf-transform/cli@4 join \
  assets/models/bot.optimized.glb assets/models/bot.joined.glb
npx -y @gltf-transform/cli@4 dequantize \
  assets/models/bot.joined.glb assets/models/bot.raw.glb

# 3. Merge the thousands of CAD primitives into a few dozen draw calls,
#    simplify a little more, and Meshopt-compress the body.
npx -y gltfpack -i assets/models/bot.raw.glb -o assets/models/bot.body.fast.glb \
  -cc -si 0.3

# 4. Onshape writes appearance colours as sRGB 8-bit values into
#    baseColorFactor, but glTF expects linear values. Without this, black
#    renders as grey and orange as yellow.
node tools/fix-onshape-colors.mjs assets/models/bot.body.fast.glb
mv assets/models/bot.body.fast.glb assets/models/bot.glb

# 5. Decode the full export once and extract the original label meshes.
#    They are a few thousand triangles, so keeping them full-res is cheap.
npx -y @gltf-transform/cli@4 copy \
  assets/models/bot.source.glb assets/models/bot.full.glb
node tools/extract-labels.mjs \
  assets/models/bot.full.glb assets/models/bot-labels.raw.glb
npx -y gltfpack -i assets/models/bot-labels.raw.glb \
  -o assets/models/bot-labels.glb -cc -si 1

# 6. Remove the large intermediates; keep the two committed files.
rm assets/models/bot.optimized.glb assets/models/bot.joined.glb \
  assets/models/bot.raw.glb assets/models/bot.full.glb \
  assets/models/bot-labels.raw.glb
```

`tools/extract-labels.mjs` selects the Onshape label meshes by index (11, 33,
34, 114 and 167). If a future export changes those indices, update `SELECTED`
in that script. It also converts the label materials from sRGB to linear, so no
separate colour fix is needed for `bot-labels.glb`.

Why `gltfpack` last: Onshape creates one primitive per face/part inside each
mesh, and `gltf-transform` cannot merge those, so its output still has thousands
of draw calls. gltfpack merges them, which is what makes the hero smooth. Check
the result with `npx @gltf-transform/cli inspect assets/models/bot.glb`; the page
reports `#robot3d.dataset.modelTris`, `#robot3d.dataset.modelLabels` and
`#robot3d.dataset.drawCalls` too. Aim for under ~500k triangles and a few
hundred draw calls. All `source/optimized/joined/raw/full/body` intermediates
are git-ignored.

**Colours (important):** Onshape exports with no textures — each material is a
single `baseColorFactor`. Those factors are sRGB values (the material names in
the GLB are literals like `0.109804_0.109804_0.109804`, i.e. 28/255), while the
glTF spec defines `baseColorFactor` as linear. `tools/fix-onshape-colors.mjs`
converts RGB to linear in the packed GLB; re-run it after every new export.

**Colours:** The hero never invents colours. They come from the part and face
appearances in Onshape; after re-exporting, run the conversion step above and
the site shows those values. For live `?onshape=` links the page applies the
same sRGB→linear correction at load time.

## 2. Render any Onshape link live

Onshape requires authentication on **every** API call, including for public
documents, and API keys must never reach the browser. So a tiny proxy does the
export and returns only the GLB. `onshape/proxy.mjs` holds the logic, and both
`server.mjs` (local) and `onshape/worker.js` (Cloudflare) use it.

### 2a. Create an Onshape API key

Onshape moved API keys out of the dev portal: open **Account settings →
Developer → API keys** (or the Developer section of your user/company
preferences) and create a key. Note the **access key** and **secret key**.

The key belongs to a user; that user must be able to open the document. A
link-shared document is *not* automatically readable through the API.

### 2b. Deploy the proxy (Cloudflare Worker, free plan is enough)

From the repo root:

```bash
npx wrangler deploy --config onshape/wrangler.toml
npx wrangler secret put ONSHAPE_ACCESS_KEY --config onshape/wrangler.toml
npx wrangler secret put ONSHAPE_SECRET_KEY --config onshape/wrangler.toml
```

Then put the Worker URL into `index.html`:

```html
<div class="stage" id="robot3d"
     data-model="assets/models/bot.glb"
     data-onshape-proxy="https://rtf-onshape-proxy.<your-subdomain>.workers.dev/gltf">
```

`ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to call the proxy
(default: `https://robotictechfrox.github.io`). Localhost is always allowed.
On an enterprise domain, add it to `ONSHAPE_HOSTS`.

### 2c. Use it

```
index.html?onshape=https://cad.onshape.com/documents/<did>/w/<wid>/e/<eid>
```

Use the URL from the browser while the Part Studio or Assembly tab is open —
it must contain `/e/<elementId>`. Versions (`/v/`) and microversions (`/m/`)
also work for Part Studios; assembly fallback exports need a workspace or
version link.

### 2d. Local testing

```bash
ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=... node server.mjs . 4173
# http://localhost:4173/?onshape=<onshape link>
```

On localhost, `robot3d.js` automatically uses `http://localhost:4173/onshape/gltf`
when `data-onshape-proxy` is empty.

---

## Notes and limits

- **Keys stay server-side.** They live in Worker secrets or environment
  variables — never in `index.html`, `robot3d.js`, or a commit.
- **Only Onshape hosts are fetched** (`*.onshape.com`, plus `ONSHAPE_HOSTS`),
  so the proxy cannot be used as a general-purpose fetch service.
- **Caching:** the Worker caches exported GLBs for one hour (up to 25 MB).
- **Size:** exports above 60 MB return a clear error; use Medium resolution or
  link a smaller tab.
- **Rendering budget:** the hero caps device pixel ratio at 1.5, uses a cheap
  contact shadow instead of shadow maps for CAD models, pauses when scrolled
  out of view, and supports both Draco and Meshopt geometry.
- **Rate limits:** Onshape rate-limits API traffic per key. The cache keeps a
  hero page from hammering it.
- **GitHub Pages:** static hosting cannot run the proxy, so hosted link
  rendering needs the Worker (or any host that can run `onshape/proxy.mjs`).
  The committed-GLB route in section 1 needs no server at all.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Placeholder stays, note says “Couldn’t load that Onshape link” | Proxy URL missing/wrong, or the link points at the document rather than a tab |
| `403` / “Check that the API key is valid…” | Key invalid, or its user cannot open the document |
| `The linked tab is a BLOB element` | Link an Assembly or Part Studio, not a drawing/file tab |
| Model renders but all grey | No part appearances set in Onshape |
| Very large / slow model | Re-export at Medium resolution and enable compression |
| `glTF references external files` | Use the binary GLB export, not `.gltf` |
