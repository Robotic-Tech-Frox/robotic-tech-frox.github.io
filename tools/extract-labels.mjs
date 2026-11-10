#!/usr/bin/env node
/*
 * Extracts the full-resolution label / number-plate geometry from the
 * uncompressed Onshape export and writes it as a small overlay GLB.
 *
 * The main bot.glb is aggressively simplified; the "37548" faces are tiny
 * compared with the 8.4M-triangle chassis, so a global simplifier melts them.
 * Keeping the original meshes in a separate overlay (a few thousand triangles)
 * preserves the lettering at almost no cost.
 *
 * Input must be an uncompressed GLB, e.g.:
 *   gltf-transform copy bot.source.glb bot.full.glb
 * Output is uncompressed; run gltfpack with -si 1 afterwards.
 *
 * Usage: node tools/extract-labels.mjs bot.full.glb bot-labels.raw.glb
 */
import fs from "node:fs";
import path from "node:path";

const srcPath = process.argv[2] || "assets/models/bot.full.glb";
const outPath = process.argv[3] || "assets/models/bot-labels.raw.glb";

// Which source meshes make up the visible labels / plates, and which of their
// primitives. Meshes 33 / 34 are Onshape's "Top Label" and "Side Label".
const SELECTED = new Map([
  [11, null],                        // red plate backer
  [33, null],                        // top label
  [34, null],                        // side label
  [114, new Set([10, 3, 47])],       // red / white plate pieces
  [167, new Set([10, 3, 47])]        // red / white plate pieces
]);

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a GLB file");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error("Expected GLB v2, got " + version);
  const total = buf.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < total) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error("GLB is missing its JSON or BIN chunk");
  return { json, bin };
}

function readAccessor(json, bin, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  if (!acc) throw new Error("Missing accessor " + accessorIndex);
  const comps = COMPONENTS[acc.type];
  if (!comps) throw new Error("Unsupported accessor type " + acc.type);
  if (acc.sparse) throw new Error("Sparse accessors are not supported");
  if (acc.bufferView === undefined) return new Float64Array(acc.count * comps);

  const view = json.bufferViews[acc.bufferView];
  if (view.buffer !== 0) throw new Error("Only the GLB binary buffer is supported");
  const compSize = COMPONENT_SIZE[acc.componentType];
  const stride = view.byteStride || compSize * comps;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float64Array(acc.count * comps);

  function readRaw(at) {
    switch (acc.componentType) {
      case 5120: return bin.readInt8(at);
      case 5121: return bin.readUInt8(at);
      case 5122: return bin.readInt16LE(at);
      case 5123: return bin.readUInt16LE(at);
      case 5125: return bin.readUInt32LE(at);
      case 5126: return bin.readFloatLE(at);
      default: throw new Error("Unsupported component type " + acc.componentType);
    }
  }
  function normalize(value) {
    if (!acc.normalized) return value;
    switch (acc.componentType) {
      case 5120: return Math.max(value / 127, -1);
      case 5121: return value / 255;
      case 5122: return Math.max(value / 32767, -1);
      case 5123: return value / 65535;
      default: return value;
    }
  }

  for (let i = 0; i < acc.count; i++) {
    const start = base + i * stride;
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = normalize(readRaw(start + c * compSize));
    }
  }
  return out;
}

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function composeMatrix(translation, rotation, scale) {
  const [tx, ty, tz] = translation || [0, 0, 0];
  const [x, y, z, w] = rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = scale || [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function transformPosition(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

function transformNormal(m, x, y, z) {
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];
  // Cofactor matrix = det(A) * inverse(A)^T, so the scale factor is irrelevant.
  const nx = (a11 * a22 - a12 * a21) * x + (a12 * a20 - a10 * a22) * y + (a10 * a21 - a11 * a20) * z;
  const ny = (a02 * a21 - a01 * a22) * x + (a00 * a22 - a02 * a20) * y + (a01 * a20 - a00 * a21) * z;
  const nz = (a01 * a12 - a02 * a11) * x + (a02 * a10 - a00 * a12) * y + (a00 * a11 - a01 * a10) * z;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function toLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function writeGlb(file, json, bin) {
  const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([
    jsonBuffer,
    Buffer.alloc((4 - (jsonBuffer.length % 4)) % 4, 0x20)
  ]);
  const binPadded = Buffer.concat([
    bin,
    Buffer.alloc((4 - (bin.length % 4)) % 4, 0)
  ]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(out, 20);
  let offset = 20 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, offset);
  out.writeUInt32LE(0x004e4942, offset + 4);
  binPadded.copy(out, offset + 8);
  fs.writeFileSync(file, out);
}

const { json, bin } = readGlb(srcPath);

// Parent map + world matrices.
const parentOf = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((node, index) => {
  (node.children || []).forEach((child) => { parentOf[child] = index; });
});

const worldCache = new Map();
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  return composeMatrix(node.translation, node.rotation, node.scale);
}
function worldMatrix(index) {
  if (worldCache.has(index)) return worldCache.get(index);
  const local = localMatrix(json.nodes[index]);
  const parent = parentOf[index];
  const result = parent === -1 ? local : multiply(worldMatrix(parent), local);
  worldCache.set(index, result);
  return result;
}

const buckets = new Map(); // material index -> { positions, normals, indices }

for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex++) {
  const node = json.nodes[nodeIndex];
  if (!Number.isInteger(node.mesh)) continue;
  const selection = SELECTED.get(node.mesh);
  if (selection === undefined) continue;

  const matrix = worldMatrix(nodeIndex);
  const mesh = json.meshes[node.mesh];
  mesh.primitives.forEach((primitive) => {
    if (selection && !selection.has(primitive.material)) return;
    if (primitive.mode !== undefined && primitive.mode !== 4) return;
    const positionAccessor = primitive.attributes.POSITION;
    if (positionAccessor === undefined) return;

    const positions = readAccessor(json, bin, positionAccessor);
    let normals = primitive.attributes.NORMAL !== undefined
      ? readAccessor(json, bin, primitive.attributes.NORMAL)
      : null;
    let indices;
    if (primitive.indices !== undefined) {
      indices = Array.from(readAccessor(json, bin, primitive.indices));
    } else {
      indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
    }

    if (!normals) {
      normals = new Float64Array(positions.length);
      for (let i = 0; i < indices.length; i += 3) {
        const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
        const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
        const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
        const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        [ia, ib, ic].forEach((offset) => {
          normals[offset] += nx;
          normals[offset + 1] += ny;
          normals[offset + 2] += nz;
        });
      }
      for (let i = 0; i < normals.length; i += 3) {
        const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= length;
        normals[i + 1] /= length;
        normals[i + 2] /= length;
      }
    }

    const material = primitive.material;
    if (!buckets.has(material)) buckets.set(material, { positions: [], normals: [], indices: [] });
    const bucket = buckets.get(material);
    const base = bucket.positions.length / 3;

    for (let i = 0; i < positions.length; i += 3) {
      const p = transformPosition(matrix, positions[i], positions[i + 1], positions[i + 2]);
      const n = transformNormal(matrix, normals[i], normals[i + 1], normals[i + 2]);
      bucket.positions.push(p[0], p[1], p[2]);
      bucket.normals.push(n[0], n[1], n[2]);
    }
    for (let i = 0; i < indices.length; i++) bucket.indices.push(base + indices[i]);
  });
}

if (!buckets.size) throw new Error("No label primitives found — node/mesh indices changed?");

// Tiny outward offset so the full-res overlay wins over the simplified plate.
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (const bucket of buckets.values()) {
  for (let i = 0; i < bucket.positions.length; i += 3) {
    minX = Math.min(minX, bucket.positions[i]);
    minY = Math.min(minY, bucket.positions[i + 1]);
    minZ = Math.min(minZ, bucket.positions[i + 2]);
    maxX = Math.max(maxX, bucket.positions[i]);
    maxY = Math.max(maxY, bucket.positions[i + 1]);
    maxZ = Math.max(maxZ, bucket.positions[i + 2]);
  }
}
const offset = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.0015;
for (const bucket of buckets.values()) {
  for (let i = 0; i < bucket.positions.length; i += 3) {
    bucket.positions[i] += bucket.normals[i] * offset;
    bucket.positions[i + 1] += bucket.normals[i + 1] * offset;
    bucket.positions[i + 2] += bucket.normals[i + 2] * offset;
  }
}

const bufferChunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
const primitives = [];
const materials = [];
const materialMap = new Map();

function addBufferView(data, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { bufferChunks.push(Buffer.alloc(pad, 0)); byteLength += pad; }
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
  if (target) view.target = target;
  bufferViews.push(view);
  bufferChunks.push(bytes);
  byteLength += bytes.length;
  return bufferViews.length - 1;
}

function addAccessor(data, type, componentType, target, min, max) {
  const view = addBufferView(data, target);
  const accessor = {
    bufferView: view,
    componentType,
    count: data.length / COMPONENTS[type],
    type
  };
  if (min) accessor.min = min;
  if (max) accessor.max = max;
  accessors.push(accessor);
  return accessors.length - 1;
}

for (const [sourceMaterial, bucket] of buckets) {
  if (!materialMap.has(sourceMaterial)) {
    const source = sourceMaterial === undefined ? {} : json.materials[sourceMaterial] || {};
    const material = JSON.parse(JSON.stringify(source));
    if (material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorFactor) {
      material.pbrMetallicRoughness.baseColorFactor = material.pbrMetallicRoughness.baseColorFactor.map((v, i) => {
        return i === 3 ? v : toLinear(v);
      });
    }
    materialMap.set(sourceMaterial, materials.length);
    materials.push(material);
  }

  const coords = new Float32Array(bucket.positions);
  const normals = new Float32Array(bucket.normals);
  const indices = new Uint32Array(bucket.indices);
  const positionMin = [Infinity, Infinity, Infinity];
  const positionMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < coords.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      positionMin[c] = Math.min(positionMin[c], coords[i + c]);
      positionMax[c] = Math.max(positionMax[c], coords[i + c]);
    }
  }
  const position = addAccessor(coords, "VEC3", 5126, 34962, positionMin, positionMax);
  const normal = addAccessor(normals, "VEC3", 5126, 34962);
  const index = addAccessor(indices, "SCALAR", 5125, 34963);
  primitives.push({
    attributes: { POSITION: position, NORMAL: normal },
    indices: index,
    material: materialMap.get(sourceMaterial),
    mode: 4
  });
}

const jsonOut = {
  asset: { version: "2.0", generator: "RTF label extractor" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Full-resolution labels", mesh: 0 }],
  meshes: [{ name: "Labels", primitives }],
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength }]
};

writeGlb(outPath, jsonOut, Buffer.concat(bufferChunks));

const triangles = primitives.reduce((sum, primitive) => sum + accessors[primitive.indices].count / 3, 0);
console.log(
  path.basename(outPath) + ": " + materials.length + " materials, " +
  primitives.length + " primitives, " + Math.round(triangles) + " triangles, " +
  (fs.statSync(outPath).size / 1048576).toFixed(2) + " MB"
);
