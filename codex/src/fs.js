import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function appendLine(filePath, line) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${line}\n`, { encoding: "utf8", flag: "a" });
}

export function readLines(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}
