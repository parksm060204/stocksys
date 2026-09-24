/**
 * Canonical JSON Serializer for Deterministic Fingerprinting in STOCKSYS
 *
 * Guarantees:
 * - Recursively sorts object keys alphabetically.
 * - Preserves array order identically.
 * - Retains all object fields within arrays (avoids replacer array truncation bug).
 * - Explicit deterministic normalization:
 *   - NaN -> "__NAN__"
 *   - Infinity -> "__INF__"
 *   - -Infinity -> "__NEG_INF__"
 *   - undefined in objects -> omitted
 *   - undefined in arrays -> null
 *   - Date -> ISO string
 *   - Map -> sorted key-value pairs [[k1, v1], [k2, v2]]
 *   - Set -> sorted array
 */

import * as crypto from 'crypto';

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function computeCanonicalHash(value: unknown): string {
  const json = canonicalSerialize(value);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val === undefined ? null : null;
  }

  if (typeof val === 'number') {
    if (isNaN(val)) return '__NAN__';
    if (!isFinite(val)) return val > 0 ? '__INF__' : '__NEG_INF__';
    return val;
  }

  if (typeof val === 'string' || typeof val === 'boolean') {
    return val;
  }

  if (typeof val === 'bigint') {
    return val.toString();
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (val instanceof Set) {
    const arr = Array.from(val).map(normalizeValue);
    arr.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return arr;
  }

  if (val instanceof Map) {
    const entries: [string, any][] = Array.from(val.entries()).map(([k, v]) => [
      String(k),
      normalizeValue(v),
    ]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }

  if (Array.isArray(val)) {
    return val.map((item) => (item === undefined ? null : normalizeValue(item)));
  }

  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const sortedObj: Record<string, unknown> = {};

    for (const key of keys) {
      const v = obj[key];
      if (v !== undefined) {
        sortedObj[key] = normalizeValue(v);
      }
    }
    return sortedObj;
  }

  return String(val);
}
