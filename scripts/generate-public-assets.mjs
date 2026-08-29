#!/usr/bin/env node

import { deflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const assets = new Map([
  ["public/favicon.png", pngIcon(32)],
  ["public/apple-touch-icon.png", pngIcon(180)],
  ["public/icon-192.png", pngIcon(192)],
  ["public/icon-512.png", pngIcon(512)],
  ["public/icon-1024.png", pngIcon(1024)],
  ["public/audio/workout-warmup.wav", wavCue([[523, 120], [659, 120], [784, 180]])],
  ["public/audio/workout-prepare.wav", wavCue([[659, 240]])],
  ["public/audio/workout-tempo.wav", wavCue([[880, 90]])],
  ["public/audio/workout-tempo-final.wav", wavCue([[1047, 180]])],
  ["public/audio/workout-complete.wav", wavCue([[659, 120], [784, 120], [1047, 260]])],
]);

const mismatches = [];
for (const [relativePath, expected] of assets) {
  const absolutePath = join(root, relativePath);
  if (checkOnly) {
    let actual = null;
    try { actual = await readFile(absolutePath); } catch { /* reported as missing */ }
    if (!actual || !actual.equals(expected)) mismatches.push(relativePath);
    continue;
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, expected);
}

if (mismatches.length) {
  console.error(`public assets differ from generator: ${mismatches.join(", ")}`);
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`public assets are reproducible (${assets.size} files)`);
} else {
  console.log(`generated ${assets.size} public assets`);
}

/** @param {number} size */
function pngIcon(size) {
  const bytesPerRow = size * 4 + 1;
  const raw = Buffer.alloc(bytesPerRow * size);
  const radius = size * 0.2;
  const edge = size * 0.06;
  const lineWidth = Math.max(1, size * 0.075);
  const logoPoints = [
    [0.25, 0.34], [0.35, 0.7], [0.5, 0.48], [0.65, 0.7], [0.75, 0.34],
  ];
  for (let y = 0; y < size; y += 1) {
    raw[y * bytesPerRow] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * bytesPerRow + 1 + x * 4;
      const inside = roundedRectContains(x + 0.5, y + 0.5, edge, edge, size - edge * 2, size - edge * 2, radius);
      const logo = logoPoints.slice(1).some((point, index) => distanceToSegment(
        x + 0.5,
        y + 0.5,
        logoPoints[index][0] * size,
        logoPoints[index][1] * size,
        point[0] * size,
        point[1] * size,
      ) <= lineWidth / 2);
      if (!inside) {
        raw[offset + 3] = 0;
      } else if (logo) {
        raw[offset] = 255;
        raw[offset + 1] = 250;
        raw[offset + 2] = 244;
        raw[offset + 3] = 255;
      } else {
        raw[offset] = 220;
        raw[offset + 1] = 80;
        raw[offset + 2] = 56;
        raw[offset + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** @param {number} x @param {number} y @param {number} left @param {number} top @param {number} width @param {number} height @param {number} radius */
function roundedRectContains(x, y, left, top, width, height, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, left + width - radius));
  const nearestY = Math.max(top + radius, Math.min(y, top + height - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** @param {number} px @param {number} py @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** @param {string} type @param {Buffer} data */
function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Array<[number, number]>} notes */
function wavCue(notes) {
  const sampleRate = 44_100;
  const gapMs = 30;
  const sampleGroups = notes.map(([frequency, durationMs]) => triangleSamples(sampleRate, frequency, durationMs));
  const gap = new Int16Array(Math.round(sampleRate * gapMs / 1_000));
  const sampleCount = sampleGroups.reduce((total, samples) => total + samples.length, 0) + gap.length * Math.max(0, notes.length - 1);
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  let cursor = 44;
  sampleGroups.forEach((samples, index) => {
    for (const sample of samples) {
      wav.writeInt16LE(sample, cursor);
      cursor += 2;
    }
    if (index < sampleGroups.length - 1) cursor += gap.length * 2;
  });
  return wav;
}

/** @param {number} sampleRate @param {number} frequency @param {number} durationMs */
function triangleSamples(sampleRate, frequency, durationMs) {
  const length = Math.round(sampleRate * durationMs / 1_000);
  const attack = Math.max(1, Math.round(sampleRate * 0.008));
  const release = Math.max(1, Math.round(sampleRate * 0.025));
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const phase = (index * frequency) % sampleRate;
    const half = sampleRate / 2;
    const triangle = phase < half ? -1 + 2 * phase / half : 3 - 2 * phase / half;
    const envelope = Math.min(1, index / attack, (length - 1 - index) / release);
    samples[index] = Math.round(triangle * envelope * 9_000);
  }
  return samples;
}
