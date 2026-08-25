// @ts-nocheck

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Replace one generated local artifact without exposing a partially written
 * file to a concurrent reader. The temporary file is removed when either the
 * write or the rename fails.
 */
export async function writeAtomicFile(path, value, encoding) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, value, encoding);
    await rename(temporaryPath, path);
  } catch (error) {
    try { await unlink(temporaryPath); } catch { /* best-effort cleanup */ }
    throw error;
  }
}
