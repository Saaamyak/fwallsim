import type { Config, ConfigEntry, ConfigObject, ConfigTable, FieldValue, Fields } from './types';
import { SCHEMA, SCHEMA_MAP, type FieldDef, type PathDef } from './schema';

const EMPTY_DEF: PathDef = { path: '', kind: 'table', fields: [] };

export const def = (path: string): PathDef => SCHEMA_MAP[path] ?? { ...EMPTY_DEF, path };
export const fdef = (pd: PathDef, name: string): FieldDef | undefined => pd.fields.find((x) => x.name === name);

export function entries(c: Config, path: string): ConfigEntry[] {
  const t = c[path];
  return t && t.kind === 'table' ? t.entries : [];
}

export const find = (c: Config, path: string, key: string) => entries(c, path).find((e) => e.key === key);

/** Get (creating if needed) a table, for writes. */
export function tableOf(c: Config, path: string): ConfigTable {
  let t = c[path];
  if (!t || t.kind !== 'table') {
    t = { kind: 'table', entries: [] };
    c[path] = t;
  }
  return t;
}

export function objectOf(c: Config, path: string): ConfigObject {
  let o = c[path];
  if (!o || o.kind !== 'object') {
    o = { kind: 'object', f: {} };
    c[path] = o;
  }
  return o;
}

/** Field as a single string (explicit value, else schema default). */
export function str(pd: PathDef, f: Fields, name: string): string {
  const v = f[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(' ');
  const d = fdef(pd, name)?.default;
  return Array.isArray(d) ? d.join(' ') : d ?? '';
}

/** Field as a list. */
export function list(pd: PathDef, f: Fields, name: string): string[] {
  const v = f[name];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v ? [v] : [];
  const d = fdef(pd, name)?.default;
  return Array.isArray(d) ? d : d ? [d] : [];
}

export function sub(f: Fields, name: string): ConfigTable | undefined {
  const v = f[name];
  return v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'table' ? v : undefined;
}

/** Nested "config <name>" block without edit/next (e.g. "config http" in an antivirus profile). */
export function subObj(f: Fields, name: string): Fields {
  const v = f[name];
  return v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'object' ? v.f : {};
}

/** Get (creating) a nested object block, for writes. */
export function subObjOf(f: Fields, name: string): Fields {
  const v = f[name];
  if (v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'object') return v.f;
  const o = { kind: 'object' as const, f: {} as Fields };
  f[name] = o;
  return o.f;
}

/** Get (creating) a nested table, for writes. */
export function subTableOf(f: Fields, name: string): ConfigTable {
  const v = f[name];
  if (v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'table') return v;
  const t: ConfigTable = { kind: 'table', entries: [] };
  f[name] = t;
  return t;
}

/** Set a field; empty values remove the explicit setting (falls back to default). */
export function setv(f: Fields, name: string, v: FieldValue | undefined) {
  if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete f[name];
  else f[name] = v;
}

/** Read a field of a single-object path (e.g. "system global"). */
export function gobj(c: Config, path: string, name: string): string {
  const o = c[path];
  return str(def(path), o && o.kind === 'object' ? o.f : {}, name);
}

/** Read a list field of a single-object path. */
export function glist(c: Config, path: string, name: string): string[] {
  const o = c[path];
  return list(def(path), o && o.kind === 'object' ? o.f : {}, name);
}

export function nextKey(c: Config, path: string): string {
  const max = entries(c, path).reduce((m, e) => Math.max(m, Number(e.key) || 0), 0);
  return String(max + 1);
}

export const newUuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        return (ch === 'x' ? r : (r & 3) | 8).toString(16);
      });

export interface RefHit {
  path: string;
  key: string;
  field: string;
}

/** Everything that references object `name` living under `targetPath`. */
export function findRefs(c: Config, targetPath: string, name: string): RefHit[] {
  const hits: RefHit[] = [];
  for (const pd of SCHEMA) {
    const refFields = pd.fields.filter((x) => x.ref?.includes(targetPath));
    if (!refFields.length) continue;
    const rows: { key: string; f: Fields }[] =
      pd.kind === 'table' ? entries(c, pd.path) : c[pd.path]?.kind === 'object' ? [{ key: '', f: (c[pd.path] as ConfigObject).f }] : [];
    for (const e of rows) {
      if (pd.path === targetPath && e.key === name) continue;
      for (const fd of refFields) if (list(pd, e.f, fd.name).includes(name)) hits.push({ path: pd.path, key: e.key, field: fd.name });
    }
  }
  // DHCP servers reference interfaces too
  return hits;
}

/** Rename an object and every reference to it. */
export function renameObject(c: Config, targetPath: string, oldName: string, newName: string) {
  const e = find(c, targetPath, oldName);
  if (e) e.key = newName;
  for (const h of findRefs(c, targetPath, oldName)) {
    const row = find(c, h.path, h.key);
    if (!row) continue;
    const v = row.f[h.field];
    if (Array.isArray(v)) row.f[h.field] = v.map((x) => (x === oldName ? newName : x));
    else if (v === oldName) row.f[h.field] = newName;
  }
}

export function cloneFields(f: Fields): Fields {
  return JSON.parse(JSON.stringify(f));
}
