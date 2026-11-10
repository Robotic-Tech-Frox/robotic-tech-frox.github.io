/*
 * Onshape's GLB exporter writes appearance colours as sRGB 8-bit values
 * (e.g. 28/255 = 0.109804) into baseColorFactor, but glTF expects linear
 * values there. Rendering the file directly lifts blacks to grey and shifts
 * oranges towards yellow. This rewrites the material factors in place.
 *
 * Usage: node tools/fix-onshape-colors.mjs assets/models/bot.glb [out.glb]
 */

import fs from "node:fs";

const input = process.argv[2];
const output = process.argv[3] || input;

if (!input) {
  console.error("Usage: node tools/fix-onshape-colors.mjs <model.glb> [out.glb]");
  process.exit(1);
}

const buf = fs.readFileSync(input);
if (buf.toString("ascii", 0, 4) !== "glTF") {
  throw new Error(input + " is not a binary glTF (.glb) file.");
}

const jsonLength = buf.readUInt32LE(12);
const jsonStart = 20;
const jsonEnd = jsonStart + jsonLength;
const json = JSON.parse(buf.toString("utf8", jsonStart, jsonEnd));

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

let converted = 0;
for (const material of json.materials || []) {
  const pbr = material.pbrMetallicRoughness;
  const color = pbr && pbr.baseColorFactor;
  if (!color) continue;
  for (let i = 0; i < 3; i++) color[i] = srgbToLinear(color[i]);
  converted++;
}

let jsonChunk = Buffer.from(JSON.stringify(json), "utf8");
const padding = (4 - (jsonChunk.length % 4)) % 4;
if (padding) jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc(padding, 0x20)]);

const rest = buf.subarray(jsonEnd);
const out = Buffer.alloc(12 + 8 + jsonChunk.length + rest.length);
out.write("glTF", 0, "ascii");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(jsonChunk.length, 12);
out.writeUInt32LE(0x4e4f534a, 16); // "JSON"
jsonChunk.copy(out, 20);
rest.copy(out, 20 + jsonChunk.length);

fs.writeFileSync(output, out);
console.log("Converted " + converted + " material colours to linear -> " + output);
