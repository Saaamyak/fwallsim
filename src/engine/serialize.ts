// Config tree <-> FortiOS configuration text ("show" / backup file format).
import type { Config, ConfigEntry, ConfigTable, FieldValue, Fields } from './types';
import { SCHEMA, SCHEMA_MAP, QUOTED, type FieldDef, type PathDef } from './schema';
import { isPwHash } from './admin';

/** Version of the FWallSim application itself. */
export const APP_VERSION = '1.0.0';
/** Firmware version the simulated device reports (like a real FortiOS unit). */
export const FW_VERSION = 'v7.4.4';
export const FW_BUILD = '2662';
export const MODEL = 'FWS60F';

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
// Admin passwords are already one-way hashes (SH2 + hex) and are written as they are; other secrets are encoded reversibly.
const encPw = (p: string) => (isPwHash(p) ? `ENC ${p}` : `ENC SH2${btoa(unescape(encodeURIComponent(p)))}`);
const decPw = (s: string) => {
  if (isPwHash(s)) return s;
  try {
    return decodeURIComponent(escape(atob(s.replace(/^SH2/, ''))));
  } catch {
    return '';
  }
};

export function fmtValue(fd: FieldDef | undefined, v: string | string[]): string {
  const vals = Array.isArray(v) ? v : [v];
  if (fd?.type === 'password') return encPw(vals.join(' '));
  if (!fd) return vals.map((x) => (/[\s"]/.test(x) || x === '' ? q(x) : x)).join(' ');
  if (QUOTED.includes(fd.type)) return vals.map(q).join(' ');
  return vals.join(' ');
}

function isDefault(fd: FieldDef, v: FieldValue): boolean {
  if (typeof v === 'object' && !Array.isArray(v)) return false;
  const d = fd.default;
  const a = Array.isArray(v) ? v.join(' ') : v;
  const b = Array.isArray(d) ? d.join(' ') : d ?? '';
  return a === b;
}

export function fieldLines(pd: PathDef | undefined, f: Fields, indent: string, full: boolean): string[] {
  const out: string[] = [];
  const known = pd?.fields ?? [];
  const names = [...known.map((x) => x.name), ...Object.keys(f).filter((k) => !known.some((x) => x.name === k))];
  for (const name of names) {
    const fd = known.find((x) => x.name === name);
    let v = f[name];
    if (v === undefined) {
      if (full && fd?.type === 'object') {
        out.push(`${indent}config ${name}`, ...fieldLines(fd.sub, {}, indent + '    ', full), `${indent}end`);
        continue;
      }
      if (!full || !fd || fd.type === 'table' || fd.type === 'object' || fd.default === undefined) continue;
      if (Array.isArray(fd.default) ? fd.default.length === 0 : fd.default === '') {
        if (fd.type === 'string' || fd.type === 'ref' || fd.type === 'uuid' || fd.type === 'password') {
          if (fd.type === 'ref' || fd.type === 'string') out.push(`${indent}set ${name} ""`);
        }
        continue;
      }
      v = fd.default;
    } else if (!full && fd && fd.type !== 'table' && fd.type !== 'object' && isDefault(fd, v)) continue;
    if (typeof v === 'object' && !Array.isArray(v) && v.kind === 'object') {
      const inner = fieldLines(fd?.sub, v.f, indent + '    ', full);
      if (inner.length || full) out.push(`${indent}config ${name}`, ...inner, `${indent}end`);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${indent}config ${name}`, ...tableLines(fd?.sub, v, indent + '    ', full), `${indent}end`);
    } else {
      out.push(`${indent}set ${name} ${fmtValue(fd, v)}`);
    }
  }
  return out;
}

export function tableLines(pd: PathDef | undefined, t: ConfigTable, indent: string, full: boolean, onlyKey?: string): string[] {
  const out: string[] = [];
  for (const e of t.entries) {
    if (onlyKey !== undefined && e.key !== onlyKey) continue;
    out.push(`${indent}edit ${pd?.key === 'int' ? e.key : q(e.key)}`, ...fieldLines(pd, e.f, indent + '    ', full), `${indent}next`);
  }
  return out;
}

/** Lines for one config path, e.g. "firewall policy". */
export function pathLines(c: Config, path: string, full = false, onlyKey?: string): string[] {
  const node = c[path];
  const pd = SCHEMA_MAP[path];
  if (!node) return [];
  if (node.kind === 'object') return [`config ${path}`, ...fieldLines(pd, node.f, '    ', full), 'end'];
  if (onlyKey !== undefined) return tableLines(pd, node, '', full, onlyKey);
  return [`config ${path}`, ...tableLines(pd, node, '    ', full), 'end'];
}

export function serializeConfig(c: Config, full = false): string {
  const header = [`#config-version=${MODEL}-${FW_VERSION.slice(1)}-FW-build${FW_BUILD}-240514:opmode=0:vdom=0:user=admin`, '#conf_file_ver=184467440737095516', `#buildno=${FW_BUILD}`, '#global_vdom=1'];
  const paths = [...SCHEMA.map((p) => p.path), ...Object.keys(c).filter((k) => !SCHEMA_MAP[k])];
  const body = paths.filter((p) => c[p]).flatMap((p) => pathLines(c, p, full));
  return [...header, ...body, ''].join('\n');
}

// ---------- parsing ----------

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let s = '';
      i++;
      while (i < line.length && line[i] !== ch) {
        if (line[i] === '\\' && i + 1 < line.length) i++;
        s += line[i++];
      }
      i++;
      out.push(s);
      continue;
    }
    let s = '';
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') s += line[i++];
    out.push(s);
  }
  return out;
}

interface Frame {
  pd?: PathDef;
  table?: ConfigTable;
  fields?: Fields;
  entry?: ConfigEntry;
}

function valueFor(fd: FieldDef | undefined, args: string[]): FieldValue {
  if (fd?.type === 'password') return args[0] === 'ENC' ? decPw(args[1] ?? '') : args.join(' ');
  const multi = fd ? ['options', 'refs', 'words', 'strings'].includes(fd.type) : args.length > 1;
  if (multi) return args;
  if (fd && (fd.type === 'ipmask' || fd.type === 'datetime')) return args.join(' ');
  return args.join(' ');
}

/** Parse a FortiOS config file. Throws on structural errors. */
export function parseConfigText(text: string): Config {
  const c: Config = {};
  const stack: Frame[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const t = tokenize(line);
    const cmd = t[0];
    const top = stack[stack.length - 1];
    const err = (m: string) => new Error(`Line ${idx + 1}: ${m}`);
    if (cmd === 'config') {
      if (top) {
        if (top.table && !top.entry) throw err('unexpected "config"');
        const name = t.slice(1).join(' ');
        const fd = top.pd?.fields.find((x) => x.name === name);
        if (fd?.type === 'object') {
          const o = { kind: 'object' as const, f: {} as Fields };
          top.fields![name] = o;
          stack.push({ pd: fd.sub, fields: o.f });
        } else {
          const tbl: ConfigTable = { kind: 'table', entries: [] };
          top.fields![name] = tbl;
          stack.push({ pd: fd?.sub, table: tbl });
        }
        return;
      }
      {
        const path = t.slice(1).join(' ');
        const pd = SCHEMA_MAP[path];
        if (pd?.kind === 'object') {
          const o = { kind: 'object' as const, f: {} as Fields };
          c[path] = o;
          stack.push({ pd, fields: o.f });
        } else {
          const tbl: ConfigTable = { kind: 'table', entries: [] };
          c[path] = tbl;
          stack.push({ pd, table: tbl });
        }
        return;
      }
    }
    if (cmd === 'edit') {
      if (!top?.table) throw err('"edit" outside of a table');
      const e: ConfigEntry = { key: t[1] ?? '', f: {} };
      top.table.entries.push(e);
      stack.push({ pd: top.pd, entry: e, fields: e.f });
      return;
    }
    if (cmd === 'set' || cmd === 'unset') {
      const fields = top?.fields;
      if (!fields) throw err(`"${cmd}" outside of an entry`);
      const name = t[1];
      if (cmd === 'unset') delete fields[name];
      else fields[name] = valueFor(top.pd?.fields.find((x) => x.name === name), t.slice(2));
      return;
    }
    if (cmd === 'next') {
      if (!top?.entry) throw err('"next" without "edit"');
      stack.pop();
      return;
    }
    if (cmd === 'end') {
      if (!top) throw err('"end" without "config"');
      if (top.entry) stack.pop(); // tolerate missing "next"
      stack.pop();
      return;
    }
    throw err(`unknown command "${cmd}"`);
  });
  if (!c['system interface'] || !c['system global']) throw new Error('This does not look like a full configuration file (missing system global / system interface).');
  return c;
}
