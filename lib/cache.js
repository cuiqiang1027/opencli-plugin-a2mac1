// Tiny disk + memory cache for slowly-changing A2MAC1 metadata.
//
// Hierarchy trees and product display names barely change (catalog updates are
// weekly at best), but a single `compare` run resolves them repeatedly. Caching
// them keeps batch runs from hammering a commercial SaaS API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CACHE_DIR = path.join(os.homedir(), '.opencli', 'cache', 'a2mac1');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const memory = new Map();

export function isCacheDisabled() {
  return process.env.A2MAC1_NO_CACHE === '1';
}

function fileFor(key) {
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

export function getCached(key, ttlMs = DEFAULT_TTL_MS) {
  if (isCacheDisabled()) return null;

  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  try {
    const raw = fs.readFileSync(fileFor(key), 'utf8');
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.at !== 'number' || Date.now() - entry.at >= ttlMs) return null;
    memory.set(key, entry);
    return entry.value;
  } catch {
    return null;
  }
}

export function setCached(key, value) {
  if (isCacheDisabled()) return;
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fileFor(key), JSON.stringify(entry), 'utf8');
  } catch {
    /* cache is best-effort only */
  }
}

export function clearCache() {
  memory.clear();
  try {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
