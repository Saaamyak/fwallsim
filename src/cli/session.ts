// FortiOS-style CLI interpreter.
// Config mode works on a working copy ("draft") of the config; "next"/"end" commit it, "abort" discards.
import type { Config, ConfigTable, FieldValue, Fields } from '../engine/types';
import { SCHEMA_MAP, type FieldDef, type PathDef } from '../engine/schema';
import { entries, find, findRefs, gobj, list, newUuid, nextKey, objectOf, renameObject, str, tableOf } from '../engine/config';
import { fieldLines, fmtValue, pathLines, serializeConfig, tableLines, tokenize } from '../engine/serialize';
import { buildNet } from '../engine/net';
import { fmtIpMask, inNet, ipToInt, isIp, netAddr, parseIpMask, parsePortRange } from '../engine/ip';
import { policyLookup } from '../engine/packet';
import type { Proto } from '../engine/objects';
import type { PacketEvent, Session } from '../engine/runtime';
import { commitConfig, endSessions, factoryReset, firewallLogout, getState, reboot, sendLocalOut, setUi, subscribe, vpnSetDown } from '../store';
import type { TunnelState } from '../engine/vpn';
import { sdwanConfig } from '../engine/sdwan';
import { setCliHistorySource } from '../labs/labs';
import { adminProfile, pathGroup, profilePerms, type Perm } from '../engine/admin';
import { ldapCheck, radiusCheck } from '../engine/auth';
import { DIAG_TREE, EXEC_TREE, GET_TREE, isWord, nextPathWords, resolvePath, resolveWord, walkTree, type CmdNode } from './words';
import {
  arpList,
  arpTable,
  compileFilter,
  dhcpLeases,
  filterTrace,
  flowFilterText,
  haStatus,
  interfaceList,
  interfacePhysical,
  nicInfo,
  perfStatus,
  routeDetails,
  routingTable,
  sessionListDiag,
  sessionListGet,
  snifferLine,
  systemStatus,
  type FlowFilter,
  type Pred,
} from './outputs';

interface Frame {
  kind: 'table' | 'object' | 'entry';
  pd: PathDef;
  label: string;
  topPath: string;
  depth: number;
  table?: ConfigTable;
  fields?: Fields;
  key?: string;
  isNew?: boolean;
  snapshot: string;
}

interface SessFilter {
  src?: string;
  dst?: string;
  sport?: number;
  dport?: number;
  proto?: number;
  policy?: number;
}

interface Sniffer {
  intf: string;
  pred: Pred;
  verbose: number;
  count: number;
  seen: number;
  start: number;
  ts: string;
}

const CMD_HELP: Record<string, string> = {
  config: 'Configure object.',
  get: 'Get dynamic and system information.',
  show: 'Show configuration.',
  diagnose: 'Diagnose facility.',
  execute: 'Execute static commands.',
  exit: 'Exit the CLI.',
  edit: 'Create/edit an object.',
  delete: 'Delete an object.',
  purge: 'Delete all objects.',
  move: 'Move an object.',
  rename: 'Rename an object.',
  clone: 'Clone an object.',
  end: 'End and save last config.',
  abort: 'End and discard last config.',
  next: 'Configure next table entry.',
  set: 'Modify value.',
  unset: 'Set to default value.',
  append: 'Append values.',
  select: 'Clear all values and add new values.',
  unselect: 'Remove values.',
};

const FAIL = (code: number, ...msg: string[]) => [...msg, `Command fail. Return code ${code}`];
const PARSE_ERR = (w: string) => FAIL(-61, `command parse error before '${w}'`);
const VALUE_ERR = (w: string) => FAIL(-651, `value parse error before '${w}'`);
const NOT_FOUND = (w: string) => FAIL(-3, 'entry not found in datasource', `value parse error before '${w}'`);

const PROTECTED: Record<string, string[]> = {
  'firewall address': ['all', 'none'],
  'firewall schedule recurring': ['always', 'none'],
  'firewall service custom': ['ALL', 'ALL_TCP', 'ALL_UDP', 'ALL_ICMP'],
  'firewall ssl-ssh-profile': ['certificate-inspection', 'deep-inspection', 'no-inspection', 'custom-deep-inspection'],
  'system accprofile': ['super_admin', 'prof_admin'],
  'system admin': ['admin'],
};

const ANY_OK = new Set(['srcintf', 'dstintf', 'extintf', 'associated-interface']);
const FIELD_HELP: Partial<Record<string, string>> = {
  ipmask: '<class_ip&net_netmask>    Please input ip address and netmask.',
  ip: '<class_ip>    Please input ip address.',
  int: '<integer>    Please input integer value.',
  string: '<string>    Please input string value.',
  password: '<password>    Please input password.',
  time: '<hh:mm>    Please input time (hh:mm).',
  datetime: '<hh:mm yyyy/mm/dd>    Please input date and time.',
  words: '<string>    Please input value(s).',
  strings: '<string>    Please input value(s).',
  uuid: '<uuid>    Universally Unique Identifier.',
};

function cloneFields(f: Fields): Fields {
  return JSON.parse(JSON.stringify(f));
}

function quoteIfNeeded(s: string) {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/** Allowed range of an integer field: from its help text "(a - b)" / "from a to b", or known limits. */
function intRange(fd: FieldDef): [number, number] {
  const h = fd.help ?? '';
  const m = /\((\d+)\s*-\s*(\d+)\)/.exec(h) ?? /from (\d+) to (\d+)/.exec(h);
  if (m && !/to disable/.test(h)) return [Number(m[1]), Number(m[2])];
  const known: Record<string, [number, number]> = {
    as: [0, 4294967295], 'remote-as': [1, 4294967295], mtu: [576, 9216], 'admin-lockout-threshold': [1, 10], 'admin-lockout-duration': [1, 2147483647],
    'radius-port': [0, 65535], 'hello-interval': [1, 65535], 'dead-interval': [1, 65535], 'holdtime-timer': [3, 65535], 'keep-alive-timer': [0, 65535],
    'packetloss-threshold': [0, 100], keylife: [120, 172800], 'lease-time': [0, 8640000], interval: [20, 3600000], failtime: [1, 3600], recoverytime: [1, 3600],
  };
  if (known[fd.name]) return known[fd.name];
  if (/port$/.test(fd.name)) return [1, 65535];
  return [0, 4294967295];
}

export class CliSession {
  out: string[] = [];
  stack: Frame[] = [];
  draft: Config | null = null;
  confirm: { msg: string; yes: () => string[] } | null = null;
  debug = { enabled: false, fn: false, count: 0, filter: {} as FlowFilter, ike: false };
  private tunnelSnap: Record<string, string> = {};
  sessFilter: SessFilter = {};
  sniffer: Sniffer | null = null;
  history: string[] = [];
  private lastSeen: number;
  private tab: { result: string; base: string[]; cands: string[]; i: number } | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  constructor() {
    setCliHistorySource(() => this.history);
    this.lastSeen = getState().runtime.seq.result;
    this.tunnelSnap = this.snapTunnels(buildNet(getState().config).tunnels);
    subscribe(() => this.onStore());
    this.out.push(`FWallSim CLI. Type "?" for help, Tab to complete. Abbreviations work: "conf sys int".`, '');
  }

  // ---------- plumbing ----------

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit(lines: string[]) {
    if (!lines.length) return;
    this.out.push(...lines);
    if (this.out.length > 4000) this.out = this.out.slice(-3000);
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get busy() {
    return !!this.sniffer;
  }

  private get host() {
    return gobj(this.cfg, 'system global', 'hostname');
  }

  private get cfg(): Config {
    return this.draft ?? getState().config;
  }

  private get top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  prompt(): string {
    if (this.confirm) return '';
    return `${this.host}${this.top ? ` (${this.top.label})` : ''} # `;
  }

  clear() {
    this.out = [];
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ---------- entry points from the UI ----------

  submit(line: string) {
    this.tab = null;
    if (this.confirm) {
      const c = this.confirm;
      this.confirm = null;
      const yes = /^y/i.test(line.trim());
      this.emit([line.trim() || 'n', ...(yes ? c.yes() : [])]);
      return;
    }
    this.emit([this.prompt() + line]);
    if (line.trim()) this.history.unshift(line);
    if (line.trim().endsWith('?')) {
      this.emit(this.help(line.trim().slice(0, -1)));
      return;
    }
    try {
      this.emit(this.run(line));
    } catch (e) {
      this.emit([`internal error: ${(e as Error).message}`]);
    }
  }

  /** "?" pressed: show context help without executing. */
  helpKey(line: string) {
    this.tab = null;
    this.emit([this.prompt() + line + '?', ...this.help(line)]);
  }

  interrupt(line: string) {
    this.tab = null;
    if (this.sniffer) return this.stopSniffer(true);
    if (this.confirm) {
      this.confirm = null;
      return this.emit(['n']);
    }
    this.emit([this.prompt() + line + '^C']);
  }

  // ---------- dispatcher ----------

  private commandsHere(): string[] {
    const t = this.top;
    if (!t) return ['config', 'show', 'get', 'diagnose', 'execute', 'exit'];
    if (t.kind === 'table') return ['edit', 'delete', 'purge', 'move', 'rename', 'clone', 'show', 'get', 'end', 'abort'];
    const base = ['set', 'unset', 'append', 'select', 'unselect', 'show', 'get', 'end', 'abort'];
    if (t.kind === 'entry') base.push('next');
    if (t.pd.fields.some((f) => f.type === 'table')) base.push('config');
    return base;
  }

  run(line: string): string[] {
    const all = tokenize(line);
    const pipe = all.indexOf('|');
    const tokens = pipe >= 0 ? all.slice(0, pipe) : all;
    if (!tokens.length) return [];
    const r = resolveWord(tokens[0], this.commandsHere());
    if (!isWord(r)) {
      if (r.error === 'ambiguous') return FAIL(-61, `ambiguous command before '${tokens[0]}'`);
      return this.top ? PARSE_ERR(tokens[0]) : ['Unknown action 0'];
    }
    const args = tokens.slice(1);
    if (['set', 'select', 'append', 'unselect', 'unset', 'delete', 'purge', 'move', 'rename', 'clone'].includes(r.word) || (r.word === 'edit' && this.top?.table && !this.top.table.entries.some((e) => e.key === args[0]))) {
      const d = this.denyWrite();
      if (d) return d;
    }
    let out: string[];
    switch (r.word) {
      case 'config':
        out = this.top ? this.configSub(args) : this.configTop(args);
        break;
      case 'show':
        out = this.show(args);
        break;
      case 'get':
        out = this.top ? this.getHere() : this.getTop(args);
        break;
      case 'diagnose':
        out = this.diagnose(args);
        break;
      case 'execute':
        out = this.execute(args);
        break;
      case 'exit':
        setUi({ cliOpen: false });
        out = [];
        break;
      case 'edit':
        out = this.edit(args);
        break;
      case 'delete':
        out = this.del(args);
        break;
      case 'purge':
        out = this.purge();
        break;
      case 'move':
        out = this.move(args);
        break;
      case 'rename':
        out = this.renameOrClone(args, false);
        break;
      case 'clone':
        out = this.renameOrClone(args, true);
        break;
      case 'set':
      case 'select':
        out = this.set(args, 'set');
        break;
      case 'append':
        out = this.set(args, 'append');
        break;
      case 'unselect':
        out = this.set(args, 'unselect');
        break;
      case 'unset':
        out = this.unset(args);
        break;
      case 'next':
        out = this.next();
        break;
      case 'end':
        out = this.end();
        break;
      case 'abort':
        out = this.abort();
        break;
      default:
        out = ['Unknown action 0'];
    }
    return pipe >= 0 ? this.grep(out, all.slice(pipe + 1)) : out;
  }

  private grep(lines: string[], args: string[]): string[] {
    if (args[0] !== 'grep') return PARSE_ERR(args[0] ?? '|');
    let i = 1;
    let ci = false;
    let block = false;
    let invert = false;
    for (; i < args.length && args[i].startsWith('-'); i++) {
      if (args[i].includes('i')) ci = true;
      if (args[i].includes('f')) block = true;
      if (args[i].includes('v')) invert = true;
    }
    const pat = args.slice(i).join(' ');
    let re: RegExp;
    try {
      re = new RegExp(pat, ci ? 'i' : '');
    } catch {
      return [`grep: invalid pattern '${pat}'`];
    }
    if (!block) return lines.filter((l) => re.test(l) !== invert);
    // -f: show the whole "edit ... next" block containing a match
    const out: string[] = [];
    let blk: string[] | null = null;
    for (const l of lines) {
      if (/^ {4}edit /.test(l)) blk = [l];
      else if (blk) {
        blk.push(l);
        if (/^ {4}next$/.test(l)) {
          if (blk.some((x) => re.test(x))) out.push(...blk.map((x) => (re.test(x) ? `${x} <---` : x)));
          blk = null;
        }
      } else if (/^(config |end$)/.test(l)) out.push(l);
    }
    return out;
  }

  // ---------- config mode ----------

  /** Permission of the logged-in admin for a config path (full access when nobody is logged in, e.g. tests). */
  private perm(path: string): Perm {
    const a = getState().auth;
    if (!a.loggedIn) return 'read-write';
    const c = getState().config;
    return profilePerms(c, adminProfile(c, a.user))[pathGroup(path)];
  }

  private denyWrite(): string[] | null {
    const t = this.top;
    return t && this.perm(t.topPath) !== 'read-write' ? FAIL(-37, 'Permission denied.') : null;
  }

  private ensureDraft() {
    if (!this.draft) this.draft = structuredClone(getState().config);
  }

  private configTop(args: string[]): string[] {
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    const m = resolvePath(args);
    if (!m.path) return m.ambiguous ? FAIL(-61, `ambiguous command before '${m.error}'`) : PARSE_ERR(m.error || args[args.length - 1]);
    if (m.rest.length) return PARSE_ERR(m.rest[0]);
    if (this.perm(m.path) === 'none') return PARSE_ERR(args[0]);
    this.ensureDraft();
    const pd = SCHEMA_MAP[m.path];
    const label = m.path.split(' ').pop()!;
    if (pd.kind === 'object') {
      const o = objectOf(this.draft!, m.path);
      this.stack.push({ kind: 'object', pd, label, topPath: m.path, depth: 0, fields: o.f, snapshot: JSON.stringify(o.f) });
    } else {
      const t = tableOf(this.draft!, m.path);
      this.stack.push({ kind: 'table', pd, label, topPath: m.path, depth: 0, table: t, snapshot: JSON.stringify(t) });
    }
    return [];
  }

  private configSub(args: string[]): string[] {
    const t = this.top!;
    const tables = t.pd.fields.filter((f) => f.type === 'table').map((f) => f.name);
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    const r = resolveWord(args[0], tables);
    if (!isWord(r)) return PARSE_ERR(args[0]);
    const fd = t.pd.fields.find((f) => f.name === r.word)!;
    let tbl = t.fields![r.word] as ConfigTable | undefined;
    if (!tbl || typeof tbl !== 'object' || Array.isArray(tbl)) {
      tbl = { kind: 'table', entries: [] };
      t.fields![r.word] = tbl;
    }
    this.stack.push({ kind: 'table', pd: fd.sub!, label: r.word, topPath: t.topPath, depth: t.depth + 1, table: tbl, snapshot: JSON.stringify(tbl) });
    return [];
  }

  private edit(args: string[]): string[] {
    const t = this.top!;
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    let key = args[0];
    if (t.pd.key === 'int') {
      if (!/^\d+$/.test(key) || Number(key) > 4294967294) return VALUE_ERR(key);
      key = String(Number(key)); // "edit 007" is entry 7
      if (key === '0') key = String(Math.max(0, ...t.table!.entries.map((e) => Number(e.key) || 0)) + 1);
    } else if (!key || key.length > 79) return VALUE_ERR(key);
    let e = t.table!.entries.find((x) => x.key === key);
    let isNew = false;
    if (!e) {
      if (t.depth === 0 && t.topPath === 'system interface' && key.length > 15) return FAIL(-61, 'Interface name is too long (max 15 characters).');
      const f: Fields = {};
      if (t.pd.fields.some((x) => x.name === 'uuid')) f.uuid = newUuid();
      if (t.depth === 0 && t.topPath === 'system interface') Object.assign(f, { vdom: 'root', type: 'vlan' });
      e = { key, f };
      t.table!.entries.push(e);
      isNew = true;
    }
    this.stack.push({ kind: 'entry', pd: t.pd, label: key, topPath: t.topPath, depth: t.depth, table: t.table, fields: e.f, key, isNew, snapshot: JSON.stringify(e.f) });
    return [];
  }

  private requiredMissing(path: string, f: Fields): string | null {
    const pd = SCHEMA_MAP[path];
    const need = (...names: string[]) => names.find((n) => !list(pd, f, n).length) ?? null;
    switch (path) {
      case 'firewall policy':
        return need('srcintf', 'dstintf', 'srcaddr', 'dstaddr', 'schedule', 'service');
      case 'firewall addrgrp':
      case 'firewall service group':
      case 'firewall schedule group':
      case 'firewall vipgrp':
        return need('member');
      case 'firewall vip':
        return need('extip', 'mappedip');
      case 'router static':
        return str(pd, f, 'blackhole') === 'enable' || list(pd, f, 'sdwan-zone').length ? null : need('device');
      case 'system interface':
        if (str(pd, f, 'type') !== 'vlan') return null;
        if (!str(pd, f, 'interface')) return 'interface';
        return str(pd, f, 'vlanid') === '0' ? 'vlanid' : null;
      default:
        return null;
    }
  }

  private commitPath(path: string, msg: string) {
    const c = structuredClone(getState().config);
    c[path] = structuredClone(this.draft![path]);
    commitConfig(c, msg);
  }

  private popAll() {
    if (this.stack.length) return;
    this.draft = null;
    // Leaving config mode: show negotiation for tunnels whose state changed (with IKE debug on).
    const ike = this.watchTunnels();
    if (ike.length) this.emit(ike);
  }

  private next(): string[] {
    const t = this.top!;
    if (t.kind !== 'entry') return PARSE_ERR('next');
    if (t.depth === 0) {
      const miss = this.requiredMissing(t.topPath, t.fields!);
      if (miss) return FAIL(-56, `Attribute '${miss}' MUST be set.`);
      if (t.isNew || JSON.stringify(t.fields) !== t.snapshot) this.commitPath(t.topPath, `${t.isNew ? 'Add' : 'Edit'} ${t.topPath.replace(/ /g, '.')} ${t.key}`);
    }
    this.stack.pop();
    return [];
  }

  private end(): string[] {
    const t = this.top!;
    if (t.kind === 'entry') {
      const r = this.next();
      if (r.length) return r;
      return this.end();
    }
    if (t.depth === 0) {
      if (t.kind === 'object' && JSON.stringify(t.fields) !== t.snapshot) this.commitPath(t.topPath, `Edit ${t.topPath.replace(/ /g, '.')}`);
      else if (t.kind === 'table') this.commitPath(t.topPath, '');
    }
    this.stack.pop();
    this.popAll();
    return [];
  }

  private abort(): string[] {
    const t = this.top!;
    if (t.kind === 'entry') {
      if (t.isNew) t.table!.entries = t.table!.entries.filter((e) => e.key !== t.key);
      else {
        for (const k of Object.keys(t.fields!)) delete t.fields![k];
        Object.assign(t.fields!, JSON.parse(t.snapshot));
      }
    } else if (t.kind === 'object') {
      for (const k of Object.keys(t.fields!)) delete t.fields![k];
      Object.assign(t.fields!, JSON.parse(t.snapshot));
    } else if (t.depth > 0) {
      t.table!.entries = (JSON.parse(t.snapshot) as ConfigTable).entries;
    }
    this.stack.pop();
    this.popAll();
    return [];
  }

  // ---------- set / unset ----------

  private refNames(fd: FieldDef): string[] {
    const c = this.cfg;
    const names: string[] = [];
    if (ANY_OK.has(fd.name)) names.push('any');
    if (fd.ref?.includes('system zone')) {
      const sw = sdwanConfig(c);
      if (sw.enabled) names.push(...sw.zones);
    }
    for (const p of fd.ref ?? []) {
      if (p === 'system vdom') names.push('root');
      else names.push(...entries(c, p).map((e) => e.key));
    }
    if (fd.ref?.includes('system interface') && (fd.name === 'srcintf' || fd.name === 'dstintf' || fd.name === 'interface' || fd.name === 'device')) {
      // hardware-switch members are never selectable; zone members are not selectable in policies
      const net = buildNet(c);
      const zoned = fd.name === 'srcintf' || fd.name === 'dstintf';
      return [...new Set(names)].filter((n) => !net.ifs[n] || (!net.ifs[n].memberOf && !(zoned && net.ifs[n].zone)));
    }
    return [...new Set(names)];
  }

  private validate(fd: FieldDef, args: string[], t: Frame): { v: FieldValue } | { err: string[] } {
    const one = args.join(' ');
    switch (fd.type) {
      case 'string':
      case 'password':
        return { v: one };
      case 'uuid':
        return /^[0-9a-f-]{36}$/i.test(one) ? { v: one } : { err: VALUE_ERR(one) };
      case 'int': {
        if (!/^\d+$/.test(one)) return { err: VALUE_ERR(one) };
        const [lo, hi] = intRange(fd);
        return Number(one) >= lo && Number(one) <= hi ? { v: String(Number(one)) } : { err: VALUE_ERR(one) };
      }
      case 'option':
        return args.length === 1 && fd.options!.includes(one) ? { v: one } : { err: VALUE_ERR(args[0]) };
      case 'options': {
        const bad = args.find((a) => !fd.options!.includes(a));
        return bad ? { err: VALUE_ERR(bad) } : { v: [...new Set(args)] };
      }
      case 'ref':
      case 'refs': {
        const ok = this.refNames(fd);
        const bad = args.find((a) => !ok.includes(a));
        if (bad) return { err: NOT_FOUND(bad) };
        if (fd.type === 'ref') return args.length === 1 ? { v: one } : { err: VALUE_ERR(args[1]) };
        return { v: [...new Set(args)] };
      }
      case 'ip':
        return args.length === 1 && isIp(one) ? { v: one } : { err: VALUE_ERR(args[0]) };
      case 'ipmask': {
        const n = parseIpMask(one);
        if (!n) return { err: VALUE_ERR(args[0]) };
        const masked = t.topPath === 'firewall address' || t.topPath === 'router static';
        return { v: fmtIpMask(masked ? { ip: netAddr(n.ip, n.prefix), prefix: n.prefix } : n) };
      }
      case 'time':
        return /^\d{1,2}:\d{2}$/.test(one) ? { v: one } : { err: VALUE_ERR(one) };
      case 'datetime':
        return /^\d{1,2}:\d{2} \d{4}\/\d{1,2}\/\d{1,2}$/.test(one) ? { v: one } : { err: VALUE_ERR(one) };
      case 'words': {
        if (fd.name.endsWith('portrange') || fd.name === 'extport' || fd.name === 'mappedport') {
          const bad = args.find((a) => !a.split(':').every((part) => parsePortRange(part)) || a.split(':').length > 2);
          if (bad) return { err: VALUE_ERR(bad) };
        }
        if (fd.name === 'extip') {
          const bad = args.find((a) => !a.split('-').every(isIp));
          if (bad) return { err: VALUE_ERR(bad) };
        }
        return { v: args };
      }
      case 'strings':
        return { v: args };
      default:
        return { err: VALUE_ERR(one) };
    }
  }

  private set(args: string[], mode: 'set' | 'append' | 'unselect'): string[] {
    const t = this.top!;
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    const r = resolveWord(args[0], t.pd.fields.map((f) => f.name));
    if (!isWord(r)) return r.error === 'ambiguous' ? FAIL(-61, `ambiguous command before '${args[0]}'`) : PARSE_ERR(args[0]);
    const fd = t.pd.fields.find((f) => f.name === r.word)!;
    if (fd.type === 'table') return FAIL(-61, `'${fd.name}' is a table. Use "config ${fd.name}".`);
    const vals = args.slice(1);
    if (!vals.length) return VALUE_ERR('');
    const multi = ['options', 'refs', 'words', 'strings'].includes(fd.type);
    if (mode !== 'set' && !multi) return PARSE_ERR(fd.name);

    // interface-specific rules
    if (t.depth === 0 && t.topPath === 'system interface' && t.kind === 'entry') {
      const net = buildNet(this.draft!);
      const me = net.ifs[t.key!];
      if (me?.memberOf && ['ip', 'mode', 'allowaccess', 'role'].includes(fd.name)) return FAIL(-61, `${t.key} is a member of hardware switch "${me.memberOf}". Configure ${me.memberOf} instead.`);
      if (fd.name === 'type' && !t.isNew) return FAIL(-651, 'The interface type cannot be changed.');
      if (fd.name === 'type' && !['vlan', 'loopback'].includes(vals[0])) return VALUE_ERR(vals[0]);
      if (fd.name === 'ip' && gobj(this.draft!, 'system settings', 'allow-subnet-overlap') !== 'enable') {
        const n = parseIpMask(vals.join(' '));
        if (n) {
          const clash = net.ifList.find((o) => o.name !== t.key && o.ip !== null && !o.memberOf && (inNet(n.ip, o.ip, Math.min(o.prefix, n.prefix)) || inNet(o.ip, n.ip, Math.min(o.prefix, n.prefix))));
          if (clash) return FAIL(-54, 'IP address is in same subnet as the others.');
        }
      }
    }
    if (t.topPath === 'system global' && fd.name === 'hostname' && !/^[A-Za-z0-9_-]{1,35}$/.test(vals.join(' '))) return VALUE_ERR(vals[0]);

    const res = this.validate(fd, vals, t);
    if ('err' in res) return res.err;
    const f = t.fields!;
    if (mode === 'set') f[fd.name] = res.v;
    else {
      const cur = list(t.pd, f, fd.name);
      const add = res.v as string[];
      f[fd.name] = mode === 'append' ? [...new Set([...cur, ...add])] : cur.filter((x) => !add.includes(x));
      if (!(f[fd.name] as string[]).length) delete f[fd.name];
    }
    return [];
  }

  private unset(args: string[]): string[] {
    const t = this.top!;
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    const r = resolveWord(args[0], t.pd.fields.map((f) => f.name));
    if (!isWord(r)) return PARSE_ERR(args[0]);
    delete t.fields![r.word];
    return [];
  }

  // ---------- table operations ----------

  private del(args: string[]): string[] {
    const t = this.top!;
    const key = args[0];
    if (!key) return FAIL(-61, 'Incomplete command.');
    if (!t.table!.entries.some((e) => e.key === key)) return NOT_FOUND(key);
    if (t.depth === 0) {
      if (PROTECTED[t.topPath]?.includes(key)) return FAIL(-23, `Built-in entry "${key}" cannot be deleted.`);
      if (t.topPath === 'vpn ipsec phase1-interface') {
        const used = findRefs(this.draft!, 'system interface', key);
        if (used.length) return FAIL(-23, `The tunnel interface "${key}" is used by other ${used.length} entr${used.length > 1 ? 'ies' : 'y'}:`, ...used.map((h) => `    ${h.path} ${h.key} (${h.field})`));
      }
      if (t.topPath === 'system interface') {
        const ty = str(t.pd, find(this.draft!, t.topPath, key)!.f, 'type');
        if (!['vlan', 'loopback'].includes(ty)) return FAIL(-23, 'Physical, hardware switch and tunnel interfaces cannot be deleted.');
      }
      const refs = findRefs(this.draft!, t.topPath, key);
      if (refs.length) return FAIL(-23, `The entry is used by other ${refs.length} entr${refs.length > 1 ? 'ies' : 'y'}:`, ...refs.map((h) => `    ${h.path} ${h.key} (${h.field})`));
    }
    t.table!.entries = t.table!.entries.filter((e) => e.key !== key);
    if (t.depth === 0) {
      if (t.topPath === 'system interface') tableOf(this.draft!, 'system dhcp server').entries = entries(this.draft!, 'system dhcp server').filter((e) => str(SCHEMA_MAP['system dhcp server'], e.f, 'interface') !== key);
      commitConfig(this.draft!, `Delete ${t.topPath.replace(/ /g, '.')} ${key}`);
    }
    return [];
  }

  private purge(): string[] {
    const t = this.top!;
    this.confirm = {
      msg: 'This operation will clear all table!',
      yes: () => {
        if (t.depth === 0) {
          const used = t.table!.entries.filter((e) => PROTECTED[t.topPath]?.includes(e.key) || findRefs(this.draft!, t.topPath, e.key).length);
          if (used.length) return FAIL(-23, `${used.length} entries are built-in or in use and cannot be purged: ${used.map((e) => e.key).join(', ')}`);
        }
        t.table!.entries = [];
        if (t.depth === 0) commitConfig(this.draft!, `Purge ${t.topPath.replace(/ /g, '.')}`);
        return [];
      },
    };
    return ['This operation will clear all table!', 'Do you want to continue? (y/n)'];
  }

  private move(args: string[]): string[] {
    const t = this.top!;
    const [a, where, b] = args;
    if (!a || !b || (where !== 'before' && where !== 'after')) return FAIL(-61, 'Usage: move <id> before|after <id>');
    const es = t.table!.entries;
    const i = es.findIndex((e) => e.key === a);
    if (i < 0) return NOT_FOUND(a);
    if (!es.some((e) => e.key === b)) return NOT_FOUND(b);
    const [row] = es.splice(i, 1);
    const j = es.findIndex((e) => e.key === b);
    es.splice(where === 'before' ? j : j + 1, 0, row);
    if (t.depth === 0) this.commitPath(t.topPath, `Move ${t.topPath.replace(/ /g, '.')} ${a} ${where} ${b}`);
    return [];
  }

  private renameOrClone(args: string[], clone: boolean): string[] {
    const t = this.top!;
    const [a, to, b] = args;
    if (!a || to !== 'to' || !b) return FAIL(-61, `Usage: ${clone ? 'clone' : 'rename'} <name> to <new name>`);
    const src = t.table!.entries.find((e) => e.key === a);
    if (!src) return NOT_FOUND(a);
    if (t.table!.entries.some((e) => e.key === b)) return FAIL(-15, `Entry "${b}" already exists.`);
    if (t.pd.key === 'int' && !/^\d+$/.test(b)) return VALUE_ERR(b);
    if (clone) {
      const f = cloneFields(src.f);
      if ('uuid' in f) f.uuid = newUuid();
      t.table!.entries.push({ key: b, f });
    } else if (t.depth === 0) renameObject(this.draft!, t.topPath, a, b);
    else src.key = b;
    if (t.depth === 0) commitConfig(this.draft!, `${clone ? 'Clone' : 'Rename'} ${t.topPath.replace(/ /g, '.')} ${a} to ${b}`);
    return [];
  }

  // ---------- show / get ----------

  private show(args: string[]): string[] {
    let full = false;
    let rest = args;
    if (rest[0] && 'full-configuration'.startsWith(rest[0]) && rest[0].length >= 2) {
      full = true;
      rest = rest.slice(1);
    }
    const t = this.top;
    const c = this.cfg;
    if (t) {
      if (rest.length) return PARSE_ERR(rest[0]);
      if (t.depth === 0 && t.kind !== 'entry') return pathLines(c, t.topPath, full);
      if (t.depth === 0 && t.kind === 'entry') return [`config ${t.topPath}`, ...pathLines(c, t.topPath, full, t.key).map((l) => '    ' + l), 'end'];
      if (t.kind === 'table') return [`config ${t.label}`, ...tableLines(t.pd, t.table!, '    ', full), 'end'];
      return [`edit ${t.pd.key === 'int' ? t.key : `"${t.key}"`}`, ...fieldLines(t.pd, t.fields!, '    ', full), 'next'];
    }
    if (!rest.length) return serializeConfig(c, full).split('\n').filter((l) => !l.startsWith('#') && l !== '');
    const m = resolvePath(rest);
    if (!m.path) return PARSE_ERR(m.error || rest[0]);
    if (!c[m.path]) return [`config ${m.path}`, 'end'];
    if (m.rest.length) {
      const lines = pathLines(c, m.path, full, m.rest.join(' '));
      if (!lines.length) return NOT_FOUND(m.rest.join(' '));
      return [`config ${m.path}`, ...lines.map((l) => '    ' + l), 'end'];
    }
    return pathLines(c, m.path, full);
  }

  private fieldListing(pd: PathDef, f: Fields, key?: string): string[] {
    const out: string[] = [];
    if (key !== undefined) out.push(`${(pd.key === 'int' ? (pd.path === 'firewall policy' ? 'policyid' : 'seq-num') : 'name').padEnd(20)}: ${key}`);
    for (const fd of pd.fields) {
      if (fd.type === 'table') {
        const tb = f[fd.name] as ConfigTable | undefined;
        out.push(`${fd.name}:`);
        for (const e of tb?.entries ?? []) out.push(`    == [ ${e.key} ]`, ...this.fieldListing(fd.sub!, e.f).map((l) => '    ' + l));
        continue;
      }
      const v = f[fd.name] ?? fd.default ?? '';
      const val = fd.type === 'password' ? (v ? 'ENC *' : '') : Array.isArray(v) ? (['refs', 'strings'].includes(fd.type) ? v.map((x) => `"${x}"`).join(' ') : v.join(' ')) : (v as string);
      out.push(`${fd.name.padEnd(20)}: ${val}`);
    }
    return out;
  }

  private getHere(): string[] {
    const t = this.top!;
    if (t.kind === 'table') return t.table!.entries.flatMap((e) => [`== [ ${e.key} ]`, this.summary(t.pd, e.key, e.f)]);
    return this.fieldListing(t.pd, t.fields!, t.kind === 'entry' ? t.key : undefined);
  }

  private summary(pd: PathDef, key: string, f: Fields): string {
    const parts = [`${pd.key === 'int' ? 'id' : 'name'}: ${key}`];
    for (const fd of pd.fields) {
      if (parts.length >= 4) break;
      const v = f[fd.name];
      if (v === undefined || fd.type === 'table' || fd.name === 'uuid') continue;
      parts.push(`${fd.name}: ${Array.isArray(v) ? v.join(' ') : v}`);
    }
    return parts.join('   ');
  }

  private getTop(args: string[]): string[] {
    if (!args.length) return FAIL(-61, 'Incomplete command.');
    const w = walkTree(GET_TREE, args);
    const words = w.words.join(' ');
    const c = this.cfg;
    const net = buildNet(c);
    const rt = getState().runtime;
    if (!w.error) {
      switch (words) {
        case 'system status':
          return systemStatus(c, rt).split('\n');
        case 'system performance status':
          return perfStatus(rt).split('\n');
        case 'system interface':
          return interfaceList(net).split('\n');
        case 'system interface physical':
          return interfacePhysical(net).split('\n');
        case 'system arp':
          return arpTable(net).split('\n');
        case 'system session list':
          return sessionListGet(rt.sessions).split('\n');
        case 'system ha status':
          return haStatus(c).split('\n');
        case 'vpn ipsec tunnel summary':
          return Object.values(net.tunnels).map((t) => `'${t.name}' ${t.remoteGw}:0  selectors(total,up): ${t.p2.length}/${t.p2.filter((p) => p.up).length}  rx(pkt,err): 0/0  tx(pkt,err): 0/0`);
        case 'vpn ssl monitor': {
          const cl = Object.values(rt.lab.sslClients ?? {});
          const host = (id: string) => net.hosts.find((h) => h.host.id === id)?.ip ?? '';
          return [
            'SSL-VPN Login Users:',
            ' Index   User     Group            Auth Type   Timeout   From',
            ...cl.map((x, i) => ` ${String(i).padEnd(8)}${x.user.padEnd(9)}${(x.groups.join(',') || '-').padEnd(17)}1(1)        N/A       ${host(x.host)}`),
            '',
            'SSL-VPN sessions:',
            ' Index   User     Source IP          Duration   I/O Bytes   Tunnel/Dest IP',
            ...cl.map((x, i) => ` ${String(i).padEnd(8)}${x.user.padEnd(9)}${host(x.host).padEnd(19)}${String(Math.round((Date.now() - x.time) / 1000)).padEnd(11)}0/0         ${x.ip}`),
          ];
        }
        case 'router info routing-table all':
          return routingTable(net, 'all').split('\n');
        case 'router info bgp summary': {
          const b = net.bgp;
          if (!b.enabled) return ['BGP is not enabled (set "as" under config router bgp).'];
          return [
            `VRF 0 BGP router identifier ${b.routerId}, local AS number ${b.as}`,
            'BGP table version is 3',
            '1 BGP AS-PATH entries',
            '0 BGP community entries',
            '',
            'Neighbor        V         AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd',
            ...b.neighbors.map((n) => `${n.ip.padEnd(16)}4 ${String(n.remoteAs).padStart(10)} ${String(n.state === 'Established' ? 12 : 0).padStart(7)} ${String(n.state === 'Established' ? 11 : 0).padStart(7)} ${String(n.state === 'Established' ? 2 : 0).padStart(8)}    0    0 ${n.state === 'Established' ? '00:05:12' : 'never   '} ${n.state === 'Established' ? String(n.received.length).padStart(8) : n.state}`),
            '',
            `Total number of neighbors ${b.neighbors.length}`,
          ];
        }
        case 'router info bgp neighbors':
          return net.bgp.neighbors.flatMap((n) => [
            `VRF 0 neighbor table:`,
            `BGP neighbor is ${n.ip}, remote AS ${n.remoteAs}, local AS ${net.bgp.as}, external link`,
            `  BGP version 4, remote router ID ${n.state === 'Established' ? n.ip : '0.0.0.0'}`,
            `  BGP state = ${n.state}${n.state === 'Established' ? ', up for 00:05:12' : ''}`,
            ...(n.reason ? [`  Last reset reason: ${n.reason}`] : []),
            `  Hold time is 180, keepalive interval is 60 seconds`,
            `  Received prefixes: ${n.received.join(', ') || 'none'}`,
            `  Advertised prefixes: ${n.advertised.join(', ') || 'none (a network statement needs a matching route in the routing table)'}`,
            '',
          ]);
        case 'router info bgp network': {
          const b = net.bgp;
          if (!b.enabled) return ['BGP is not enabled.'];
          const rows: string[] = [];
          for (const n of b.neighbors.filter((x) => x.state === 'Established')) for (const p of n.received) rows.push(`*> ${p.padEnd(17)}${n.ip.padEnd(20)}     0             0        0 ${n.remoteAs} i <-/1>`);
          for (const p of b.neighbors.find((x) => x.state === 'Established')?.advertised ?? []) rows.push(`*> ${p.padEnd(17)}${'0.0.0.0'.padEnd(20)}          100  32768        0 i <-/1>`);
          return [`VRF 0 BGP table version is 3, local router ID is ${b.routerId}`, 'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal', 'Origin codes: i - IGP, e - EGP, ? - incomplete', '', '   Network          Next Hop            Metric LocPrf Weight RouteTag Path', ...rows, '', `Total number of prefixes ${rows.length}`];
        }
        case 'router info ospf neighbor':
          return ['OSPF process 0, VRF 0:', 'Neighbor ID     Pri   State           Dead Time   Address         Interface', ...net.ospf.neighbors.map((n) => `${n.routerId.padEnd(16)}  1   ${(n.state === 'Full' ? 'Full/ -' : n.state + '/ -').padEnd(16)}00:00:35    ${n.ip.padEnd(16)}${n.intf}${n.reason ? `   (${n.reason})` : ''}`)];
        case 'router info ospf interface':
          return net.ospf.interfaces.flatMap((i) => [`${i.name} is up, line protocol is up`, `  Internet Address ${i.ip}, Area ${i.area}, MTU 1500`, `  Process ID 0, VRF 0, Router ID ${net.ospf.routerId}, Network Type ${net.tunnels[i.name] ? 'POINTOPOINT' : 'BROADCAST'}, Cost: ${i.cost}`, `  Timer intervals configured, Hello ${i.hello}, Dead ${i.dead}, Wait ${i.dead}, Retransmit 5`, `  Neighbor Count is ${net.ospf.neighbors.filter((n) => n.intf === i.name).length}, Adjacent neighbor count is ${net.ospf.neighbors.filter((n) => n.intf === i.name && n.state === 'Full').length}`]);
        case 'router info ospf status':
          return net.ospf.enabled ? [` Routing Process "ospf 0" with ID ${net.ospf.routerId}`, ' Process uptime is 5 minutes', ' Supports only single TOS(TOS0) routes', ` Number of areas attached to this router: ${new Set(net.ospf.interfaces.map((i) => i.area)).size}`] : ['OSPF is not enabled (add a network statement under config router ospf).'];
        case 'router info routing-table database':
          return routingTable(net, 'database').split('\n');
        case 'router info routing-table details':
          return routeDetails(net, w.rest[0]).split('\n');
      }
      if (w.node.c && words !== 'system' && words !== 'router') {
        /* incomplete special command: fall through to config path */
      }
    }
    const m = resolvePath(args);
    if (!m.path) return w.error && w.words.length >= 1 ? PARSE_ERR(w.error) : PARSE_ERR(m.error || args[0]);
    const pd = SCHEMA_MAP[m.path];
    const node = c[m.path];
    if (!node) return [];
    if (node.kind === 'object') return this.fieldListing(pd, node.f);
    if (m.rest.length) {
      const e = find(c, m.path, m.rest.join(' '));
      return e ? this.fieldListing(pd, e.f, e.key) : NOT_FOUND(m.rest.join(' '));
    }
    return node.entries.flatMap((e) => [`== [ ${e.key} ]`, this.summary(pd, e.key, e.f)]);
  }

  // ---------- diagnose ----------

  private sessionsFiltered(): Session[] {
    const f = this.sessFilter;
    return getState().runtime.sessions.filter(
      (s) =>
        (!f.src || s.src === f.src) &&
        (!f.dst || s.dst === f.dst) &&
        (f.sport === undefined || s.sport === f.sport) &&
        (f.dport === undefined || s.dport === f.dport) &&
        (f.proto === undefined || ({ tcp: 6, udp: 17, icmp: 1 } as Record<string, number>)[s.proto] === f.proto) &&
        (f.policy === undefined || s.policyid === f.policy),
    );
  }

  private diagnose(args: string[]): string[] {
    if (this.top) return PARSE_ERR('diagnose');
    const w = walkTree(DIAG_TREE, args);
    if (w.error) return w.ambiguous ? FAIL(-61, `ambiguous command before '${w.error}'`) : PARSE_ERR(w.error);
    if (w.node.c && !(w.words.join(' ') === 'debug flow filter' || w.words.join(' ') === 'sys session filter')) return FAIL(-61, 'Incomplete command.');
    const cmd = w.words.join(' ');
    const a = w.rest;
    const num = (v?: string) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN);
    switch (cmd) {
      case 'debug enable':
        this.debug.enabled = true;
        return [];
      case 'debug disable':
        this.debug.enabled = false;
        return [];
      case 'debug reset':
        this.debug.enabled = false;
        this.debug.count = 0;
        this.debug.ike = false;
        return [];
      case 'debug application ike':
        if (a[0] === undefined || !/^-?\d+$/.test(a[0])) return VALUE_ERR(a[0] ?? '');
        this.debug.ike = a[0] !== '0';
        return [];
      case 'vpn tunnel list':
        return this.tunnelList();
      case 'vpn tunnel up':
      case 'vpn tunnel down': {
        const tunnels = buildNet(this.cfg).tunnels;
        const t = Object.values(tunnels).find((x) => x.name === a[0] || x.p2.some((p) => p.name === a[0]));
        if (!t) return [`Can not find a tunnel named ${a[0] ?? ''}`];
        vpnSetDown(t.name, w.words[2] === 'down'); // the store change prints IKE debug through onStore
        return [];
      }
      case 'vpn ike gateway list':
        return Object.values(buildNet(this.cfg).tunnels).flatMap((t) => [
          'vd: root/0',
          `name: ${t.name}`,
          `version: ${t.ikeVersion}`,
          `interface: ${t.outIntf}`,
          `addr: ${t.localGw ?? '0.0.0.0'}:500 -> ${t.remoteGw}:500`,
          `auth-method: psk`,
          `IKE SA: created 1/1  established ${t.p1Up ? '1/1' : '0/1'}`,
          `IPsec SA: created ${t.p2.length}/${t.p2.length}  established ${t.p2.filter((p) => p.up).length}/${t.p2.length}`,
          t.p1Up ? `  status: established` : `  status: connecting (${t.error ?? 'down'})`,
          '',
        ]);
      case 'debug info':
        return [`debug output:           ${this.debug.enabled ? 'enable' : 'disable'}`, `console timestamp:      disable`, `console no user log message:    disable`, `flow trace remaining:   ${this.debug.count}`, `CLI debug level:        3`];
      case 'debug flow filter':
        return flowFilterText(this.debug.filter).split('\n');
      case 'debug flow filter clear':
        this.debug.filter = {};
        return [];
      case 'debug flow filter addr':
      case 'debug flow filter saddr':
      case 'debug flow filter daddr': {
        if (!a[0] || !isIp(a[0])) return VALUE_ERR(a[0] ?? '');
        this.debug.filter[w.words[3] as 'addr' | 'saddr' | 'daddr'] = a[0];
        return [];
      }
      case 'debug flow filter port':
      case 'debug flow filter sport':
      case 'debug flow filter dport':
      case 'debug flow filter proto': {
        const n = num(a[0]);
        if (isNaN(n)) return VALUE_ERR(a[0] ?? '');
        this.debug.filter[w.words[3] as 'port' | 'sport' | 'dport' | 'proto'] = n;
        return [];
      }
      case 'debug flow show function-name enable':
        this.debug.fn = true;
        return [];
      case 'debug flow show function-name disable':
        this.debug.fn = false;
        return [];
      case 'debug flow trace start': {
        const n = a[0] === undefined ? 1 : num(a[0]);
        if (isNaN(n)) return VALUE_ERR(a[0]);
        this.debug.count = n;
        return this.debug.enabled ? [] : ['(note: debug output is disabled. Run "diagnose debug enable" to see trace output.)'];
      }
      case 'debug flow trace stop':
        this.debug.count = 0;
        return [];
      case 'sys session list':
        return sessionListDiag(this.sessionsFiltered()).split('\n');
      case 'sys session stat': {
        const s = getState().runtime.sessions;
        const by = (st: string) => s.filter((x) => x.proto === 'tcp' && x.state === st).length;
        return [`misc info:\tsession_count=${s.length} setup_rate=0 exp_count=0 clash=0`, `\tmemory_tension_drop=0 ephemeral=0/65536 removeable=0`, `delete=0, flush=0, dev_down=0/0 ses_walkers=0`, `TCP sessions:`, `\t ${by('established')} in ESTABLISHED state`, `\t ${by('syn_sent')} in SYN_SENT state`, `\t ${by('close')} in CLOSE state`, `firewall error stat:`, `error1=00000000`, `error2=00000000`, `error3=00000000`, `error4=00000000`, `tt=00000000`, `cont=00000000`, `ids_recv=00000000`, `url_recv=00000000`, `av_recv=00000000`, `fqdn_count=00000000`, `fqdn6_count=00000000`, `global: ses_limit=0 ses6_limit=0 rt_limit=0 rt6_limit=0`];
      }
      case 'sys session filter': {
        const f = this.sessFilter;
        const r = (v?: string | number) => (v !== undefined && v !== '' ? `${v}-${v}` : 'any');
        return ['session filter:', `\tvd: any`, `\tsintf: any`, `\tdintf: any`, `\tproto: ${f.proto ?? 'any'}`, `\tproto-state: any`, `\tsource ip: ${r(f.src)}`, `\tNAT'd source ip: any`, `\tdest ip: ${r(f.dst)}`, `\tNAT'd dest ip: any`, `\tsource port: ${r(f.sport)}`, `\tNAT'd source port: any`, `\tdest port: ${r(f.dport)}`, `\tNAT'd dest port: any`, `\tpolicy id: ${r(f.policy)}`, `\texpire: any`, `\tduration: any`, `\tproto-state: any`, `\tsession-state1: any`, `\tsession-state2: any`, `\text-src: negate`, `\text-dst: negate`, `\tep-src: negate`, `\tep-dst: negate`];
      }
      case 'sys session filter clear':
        this.sessFilter = {};
        return [];
      case 'sys session filter src':
      case 'sys session filter dst':
        if (!a[0] || !isIp(a[0])) return VALUE_ERR(a[0] ?? '');
        this.sessFilter[w.words[3] as 'src' | 'dst'] = a[0];
        return [];
      case 'sys session filter sport':
      case 'sys session filter dport':
      case 'sys session filter proto':
      case 'sys session filter policy': {
        const n = num(a[0]);
        if (isNaN(n)) return VALUE_ERR(a[0] ?? '');
        this.sessFilter[w.words[3] as 'sport' | 'dport' | 'proto' | 'policy'] = n;
        return [];
      }
      case 'sys session clear': {
        const ids = this.sessionsFiltered().map((s) => s.id);
        endSessions(Object.keys(this.sessFilter).length ? ids : 'all');
        return [];
      }
      case 'sys sdwan health-check': {
        const st = buildNet(this.cfg).sdwan;
        if (!st.enabled) return ['SD-WAN is disabled.'];
        return st.health.flatMap((h) => [
          `Health Check(${h.name}):`,
          ...h.members.map((m) => `Seq(${m.seq} ${m.intf}): state(${m.alive ? 'alive' : 'dead'}), packet-loss(${m.loss.toFixed(3)}%) latency(${m.latency.toFixed(3)}), jitter(${m.jitter.toFixed(3)}), mos(${m.alive ? '4.403' : '0.000'}), bandwidth-up(999999), bandwidth-dw(999999), bandwidth-bi(1999998) sla_map=0x${m.sla.reduce((acc, ok, i) => acc | ((ok ? 1 : 0) << i), 0).toString(16)}`),
        ]);
      }
      case 'sys sdwan member': {
        const st = buildNet(this.cfg).sdwan;
        if (!st.enabled) return ['SD-WAN is disabled.'];
        return st.members.map((m) => `Member(${m.seq}): interface: ${m.intf}, flags=0x0 , gateway: ${m.gateway}, priority: ${m.priority} 1024, weight: 0${m.alive ? '' : '  (dead)'}`);
      }
      case 'sys sdwan service': {
        const c = this.cfg;
        const net = buildNet(c);
        if (!net.sdwan.enabled) return ['SD-WAN is disabled.'];
        const S = SCHEMA_MAP['system sdwan'].fields.find((x) => x.name === 'service')!.sub!;
        const svc = c['system sdwan']?.kind === 'object' ? (c['system sdwan'].f['service'] as ConfigTable | undefined)?.entries ?? [] : [];
        if (!svc.length) return ['(no SD-WAN rules: all traffic uses the implicit rule, i.e. the routing table with source-ip-based load balancing)'];
        return svc.flatMap((e) => {
          const order = list(S, e.f, 'priority-members');
          const mem = (order.length ? order : net.sdwan.members.map((m) => m.seq)).map((q) => net.sdwan.members.find((m) => m.seq === q)).filter(Boolean) as typeof net.sdwan.members;
          const firstAlive = mem.find((m) => m.alive);
          return [
            `Service(${e.key}): Address Mode(IPV4) flags=0x200 ${str(S, e.f, 'name')}`,
            `  Gen(1), TOS(0x0/0x0), Protocol(${str(S, e.f, 'protocol')}: ${str(S, e.f, 'start-port')}->${str(S, e.f, 'end-port')}), Mode(${str(S, e.f, 'mode')})`,
            `  Members(${mem.length}):`,
            ...mem.map((m, i) => `    ${i + 1}: Seq_num(${m.seq} ${m.intf}), ${m.alive ? 'alive' : 'dead'}${str(S, e.f, 'mode') === 'manual' && m === firstAlive ? ', selected' : ''}`),
            `  Dst address(${list(S, e.f, 'dst').length}): ${list(S, e.f, 'dst').join(', ') || 'all'}`,
            '',
          ];
        });
      }
      case 'sniffer packet':
        return this.startSniffer(a);
      case 'ip arp list':
        return arpList(buildNet(this.cfg)).split('\n');
      case 'firewall iprope lookup': {
        const [src, sport, dst, dport, proto, dev] = a;
        if (!dev) return FAIL(-61, 'Usage: diagnose firewall iprope lookup <src_ip> <src_port> <dst_ip> <dst_port> <protocol> <dev>');
        const p: Proto | null = proto === '6' || proto === 'tcp' ? 'tcp' : proto === '17' || proto === 'udp' ? 'udp' : proto === '1' || proto === 'icmp' ? 'icmp' : null;
        if (!p || !isIp(src) || !isIp(dst)) return VALUE_ERR(!isIp(src) ? src : !isIp(dst) ? dst : proto);
        const r = policyLookup(this.cfg, { srcintf: dev, proto: p, src, dst, dport: Number(dport) || 0 });
        return [`<src [${src}-${sport}] dst [${dst}-${dport}] proto ${p} dev ${dev}> matches policy id: ${r.policyId ?? 'none'}`, `(${r.message})`];
      }
      case 'firewall auth list': {
        const list = Object.values(getState().runtime.lab.auth);
        const now = Date.now();
        return [
          ...list.flatMap((a) => [
            `${a.ip}, ${a.user}`,
            `  type: fw, id: 0, duration: ${Math.round((now - a.time) / 1000)}, idled: 0`,
            `  expire: ${Math.max(0, Math.round((a.expires - now) / 1000))}, allow-idle: ${Math.round((a.expires - a.time) / 1000)}`,
            `  server: ${a.server ?? 'local'}`,
            `  packets: in 0 out 0, bytes: in 0 out 0`,
            ...a.groups.map((g, i) => `  group_id: ${i + 1}
  group_name: ${g}`),
            '',
          ]),
          `----- ${list.length} listed, 0 filtered ------`,
        ];
      }
      case 'firewall auth clear':
        Object.keys(getState().runtime.lab.auth).forEach(firewallLogout);
        return [];
      case 'test authserver ldap': {
        const [srv, user, pw] = a;
        if (!pw) return FAIL(-61, 'Usage: diagnose test authserver ldap <server> <user> <password>');
        const r = ldapCheck(this.cfg, srv, user, pw);
        if (!r.ok) return [`authenticate '${user}' against '${srv}' failed!`, `(${r.msg})`];
        return [`authenticate '${user}' against '${srv}' succeeded!`, ...(r.groups ?? []).map((g) => `Group membership(s) - ${g}`)];
      }
      case 'test authserver radius': {
        const [srv, , user, pw] = a;
        if (!pw) return FAIL(-61, 'Usage: diagnose test authserver radius <server> <chap|pap|mschap|mschap2> <user> <password>');
        const r = radiusCheck(this.cfg, srv, user, pw);
        if (!r.ok) return [`authenticate '${user}' against '${a[1]}' failed!`, `(${r.msg})`];
        return [`authenticate '${user}' against '${a[1]}' succeeded, server=primary assigned_rad_session_id=0 session_timeout=0 secs idle_timeout=0 secs!`];
      }
      case 'hardware deviceinfo nic':
        if (!a[0]) return FAIL(-61, 'Incomplete command.');
        return nicInfo(this.cfg, buildNet(this.cfg), a[0]).split('\n');
    }
    return FAIL(-61, 'Incomplete command.');
  }

  private tunnelList(): string[] {
    const tunnels = Object.values(buildNet(this.cfg).tunnels);
    const out = ['list all ipsec tunnel in vd 0'];
    for (const t of tunnels) {
      out.push(
        '------------------------------------------------------',
        `name=${t.name} ver=${t.ikeVersion} serial=1 ${t.localGw ?? '0.0.0.0'}:0->${t.remoteGw}:0 tun_id=${t.remoteGw} dst_mtu=1500 dpd-link=on weight=1`,
        `bound_if=5 lgwy=static/1 tun=intf mode=auto/1 encap=none/552 options[0228]=npu frag-rfc  run_state=${t.up ? 0 : 1} role=primary accept_traffic=${t.up ? 1 : 0}`,
        '',
        `proxyid_num=${t.p2.length} child_num=0 refcnt=4 ilast=2 olast=2 ad=/0`,
        `stat: rxp=0 txp=0 rxb=0 txb=0`,
        `dpd: mode=on-demand on=${t.p1Up ? 1 : 0} idle=20000ms retry=3 count=0 seqno=0`,
        `natt: mode=none draft=0 interval=0 remote_port=0`,
      );
      for (const p of t.p2) {
        const fmt = (x: string) => x.replace(' ', '/');
        out.push(`proxyid=${p.name} proto=0 sa=${p.up ? 1 : 0} ref=2 serial=1`, `  src: 0:${fmt(p.src)}:0`, `  dst: 0:${fmt(p.dst)}:0`);
        if (p.up) out.push('  SA:  ref=3 options=10226 type=00 soft=0 mtu=1438 expire=42898/0B replaywin=2048', '  life: type=01 bytes=0/0 timeout=42899/43200', '  dec: spi=8b5c3f01 esp=aes key=32', '  enc: spi=d4a1e902 esp=aes key=32');
        else if (p.error) out.push(`  (down: ${p.error})`);
      }
      if (!t.p1Up && t.error) out.push(`(phase 1 down: ${t.error})`);
    }
    return out;
  }

  private startSniffer(a: string[]): string[] {
    const net = buildNet(this.cfg);
    const intf = a[0] ?? 'any';
    if (intf !== 'any' && !net.ifs[intf]) return [`Interface ${intf} not found`];
    const filter = a[1] ?? 'none';
    const pred = compileFilter(filter);
    if (typeof pred === 'string') return [`Invalid filter: ${pred}`];
    const verbose = a[2] ? Number(a[2]) : 1;
    if (!(verbose >= 1 && verbose <= 6)) return VALUE_ERR(a[2]);
    const count = a[3] ? Number(a[3]) : 0;
    const ts = a[4] === 'a' || a[4] === 'l' ? a[4] : 'r';
    const members = intf !== 'any' && net.ifs[intf]?.members.length ? net.ifs[intf].members : [];
    this.sniffer = {
      intf,
      pred: (e: PacketEvent) => (intf === 'any' || e.intf === intf || members.includes(e.intf)) && pred(e),
      verbose,
      count,
      seen: 0,
      start: Date.now(),
      ts,
    };
    return ['Using Original Sniffing Mode', `interfaces=[${intf}]`, `filters=[${filter}]`, '(Send traffic from the Lab panel. Press Ctrl+C to stop.)'];
  }

  private stopSniffer(interrupted: boolean) {
    const s = this.sniffer;
    if (!s) return;
    this.sniffer = null;
    this.emit([...(interrupted ? ['^C'] : []), '', `${s.seen} packets received by filter`, '0 packets dropped by kernel', '']);
  }

  // ---------- execute ----------

  private execute(args: string[]): string[] {
    if (this.top) return PARSE_ERR('execute');
    const w = walkTree(EXEC_TREE, args);
    if (w.error) return w.ambiguous ? FAIL(-61, `ambiguous command before '${w.error}'`) : PARSE_ERR(w.error);
    if (w.node.c) return FAIL(-61, 'Incomplete command.');
    const cmd = w.words.join(' ');
    const a = w.rest;
    const d = new Date();
    switch (cmd) {
      case 'ping':
        return a[0] ? this.ping(a[0]) : FAIL(-61, 'Incomplete command.');
      case 'traceroute':
        return a[0] ? this.traceroute(a[0]) : FAIL(-61, 'Incomplete command.');
      case 'date':
        return [`current date is: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`];
      case 'time':
        return [`current time is: ${d.toTimeString().slice(0, 8)}`, 'last ntp sync: never'];
      case 'dhcp lease-list':
        return dhcpLeases(buildNet(this.cfg)).split('\n');
      case 'backup config': {
        if (a[0] !== 'tftp' || !a[1] || !a[2]) return FAIL(-61, 'Usage: execute backup config tftp <filename> <server_ip>');
        if (!isIp(a[2])) return VALUE_ERR(a[2]);
        const txt = serializeConfig(getState().config);
        try {
          const blob = new Blob([txt], { type: 'text/plain' });
          const el = document.createElement('a');
          el.href = URL.createObjectURL(blob);
          el.download = a[1];
          el.click();
          URL.revokeObjectURL(el.href);
        } catch {
          /* non-browser */
        }
        return ['Please wait...', '', `Connect to tftp server ${a[2]} ...`, '#', 'Send config file to tftp server OK.', `(saved by your browser as ${a[1]})`];
      }
      case 'reboot':
        this.confirm = { msg: '', yes: () => (reboot(), ['', 'The system is going down NOW !!']) };
        return ['This operation will reboot the system !', 'Do you want to continue? (y/n)'];
      case 'factoryreset':
        this.confirm = { msg: '', yes: () => (factoryReset(), ['', 'The system is going down NOW !!']) };
        return ['This operation will reset the system to factory default!', 'Do you want to continue? (y/n)'];
    }
    return FAIL(-61, 'Incomplete command.');
  }

  private ping(target: string): string[] {
    const r = sendLocalOut(target, 'ping');
    if (r.error === 'Unable to resolve hostname.') return ['Unable to resolve hostname.'];
    const dst = r.dst ?? target;
    const head = `PING ${target} (${dst}): 56 data bytes`;
    if (r.error) return [head, r.error];
    const local = r.hops.length === 1 && r.hops[0] === dst && !r.result.packets?.length;
    const lan = r.hops.length === 1;
    const base = local ? 0.02 : lan ? 0.4 : 8 + (getState().runtime.lab.ispLatency?.[r.via ?? 'wan1'] ?? 4);
    const ttl = local ? 255 : lan ? 64 : 117;
    if (!r.ok) return [head, '', `--- ${dst} ping statistics ---`, '5 packets transmitted, 0 packets received, 100% packet loss'];
    const rtts = Array.from({ length: 5 }, () => +(base + Math.random() * base * 0.3).toFixed(1) || 0.1);
    return [
      head,
      ...rtts.map((t, i) => `64 bytes from ${dst}: icmp_seq=${i} ttl=${ttl} time=${t} ms`),
      '',
      `--- ${dst} ping statistics ---`,
      '5 packets transmitted, 5 packets received, 0% packet loss',
      `round-trip min/avg/max = ${Math.min(...rtts)}/${(rtts.reduce((x, y) => x + y, 0) / 5).toFixed(1)}/${Math.max(...rtts)} ms`,
    ];
  }

  private traceroute(target: string): string[] {
    const r = sendLocalOut(target, 'traceroute');
    if (r.error === 'Unable to resolve hostname.') return ['Unable to resolve hostname.'];
    const dst = r.dst ?? target;
    const out = [`traceroute to ${target} (${dst}), 32 hops max, 3 probe packets per hop, 84 byte packets`];
    if (r.error) return [...out, r.error];
    r.hops.forEach((h, i) => {
      const b = (i + 1) * 3 + Math.random();
      out.push(` ${i + 1}  ${h}  ${b.toFixed(3)} ms  ${(b * 0.97).toFixed(3)} ms  ${(b * 1.02).toFixed(3)} ms`);
    });
    if (!r.ok) for (let i = r.hops.length + 1; i <= r.hops.length + 3; i++) out.push(` ${i}  * * *`);
    return out;
  }

  // ---------- live output from Lab traffic ----------

  private snapTunnels(t: Record<string, TunnelState>) {
    return Object.fromEntries(Object.values(t).map((x) => [x.name, `${x.up}|${x.p1Up}|${x.error ?? ''}`]));
  }

  /** Print IKE negotiation output when a tunnel changes state (with "diagnose debug application ike -1"). */
  private watchTunnels(force?: string) {
    const tunnels = buildNet(getState().config).tunnels;
    const snap = this.snapTunnels(tunnels);
    const lines: string[] = [];
    for (const t of Object.values(tunnels)) {
      if ((snap[t.name] !== this.tunnelSnap[t.name] || force === t.name) && this.debug.ike && this.debug.enabled) lines.push(...t.ike);
    }
    this.tunnelSnap = snap;
    return lines;
  }

  private onStore() {
    if (!this.draft) {
      const ike = this.watchTunnels();
      if (ike.length) this.emit(ike);
    }
    const hist = getState().runtime.history;
    const fresh = hist.filter((h) => h.id > this.lastSeen).reverse();
    if (!fresh.length) {
      if (hist.length && hist[0].id < this.lastSeen) this.lastSeen = hist[0].id;
      return;
    }
    this.lastSeen = fresh[fresh.length - 1].id;
    const lines: string[] = [];
    for (const r of fresh) {
      if (this.debug.enabled && this.debug.count > 0) {
        for (const g of filterTrace(r.debug, this.debug.filter)) {
          if (this.debug.count <= 0) break;
          lines.push(...g.map((l) => (this.debug.fn ? l : l.replace(/ func=\S+ line=\d+/, ''))));
          this.debug.count--;
        }
      }
      const s = this.sniffer;
      if (s) {
        for (const e of r.packets ?? []) {
          if (!s.pred(e)) continue;
          const t = (r.time - s.start + e.t) / 1000;
          const abs = new Date(r.time + e.t);
          const ts =
            s.ts === 'r'
              ? t.toFixed(6)
              : s.ts === 'a'
                ? abs.toISOString().replace('T', ' ').replace('Z', '')
                : `${abs.getFullYear()}-${String(abs.getMonth() + 1).padStart(2, '0')}-${String(abs.getDate()).padStart(2, '0')} ${abs.toTimeString().slice(0, 8)}.${String(abs.getMilliseconds()).padStart(3, '0')}000`;
          lines.push(...snifferLine(e, s.verbose, ts));
          s.seen++;
          if (s.count > 0 && s.seen >= s.count) break;
        }
      }
    }
    this.emit(lines);
    if (this.sniffer && this.sniffer.count > 0 && this.sniffer.seen >= this.sniffer.count) this.stopSniffer(false);
  }

  // ---------- help and completion ----------

  /** Candidate words (with help) for the token being typed. */
  private candidates(tokens: string[]): { w: string; h: string }[] {
    const t = this.top;
    const cmds = this.commandsHere();
    if (tokens.length <= 1) return cmds.map((w) => ({ w, h: CMD_HELP[w] ?? '' }));
    const r = resolveWord(tokens[0], cmds);
    if (!isWord(r)) return [];
    const cmd = r.word;
    const args = tokens.slice(1);
    const c = this.cfg;
    const pathCands = (prev: string[]) => {
      const m = prev.length ? resolvePath(prev) : { consumed: [] as string[], path: undefined, rest: [] as string[] };
      if ('error' in m && m.error !== undefined && !m.path) {
        // partially resolved path prefix
        if (m.rest?.length) return [];
      }
      const consumed = m.consumed ?? [];
      if (m.path && m.rest.length === 0) {
        const more = nextPathWords(consumed);
        const keys = SCHEMA_MAP[m.path].kind === 'table' ? entries(c, m.path).map((e) => ({ w: e.key, h: '' })) : [];
        return [...more.map((w) => ({ w, h: '' })), ...(cmd === 'show' || cmd === 'get' ? keys : [])];
      }
      if (m.path) return [];
      return nextPathWords(consumed).map((w) => {
        const p = [...consumed, w].join(' ');
        return { w, h: SCHEMA_MAP[p]?.help ?? '' };
      });
    };
    const treeCands = (root: CmdNode, prev: string[]) => {
      const w = walkTree(root, prev);
      if (w.error || !w.node.c) return w.node.arg ? [{ w: w.node.arg, h: '', arg: true }] : [];
      return Object.entries(w.node.c).map(([k, n]) => ({ w: k, h: n.h }));
    };
    switch (cmd) {
      case 'config':
        if (t) return t.pd.fields.filter((f) => f.type === 'table').map((f) => ({ w: f.name, h: f.help ?? '' }));
        return pathCands(args.slice(0, -1));
      case 'show': {
        if (t) return args.length <= 1 ? [{ w: 'full-configuration', h: 'Show full configuration.' }] : [];
        const prev = args.slice(0, -1);
        const pre = prev[0] && 'full-configuration'.startsWith(prev[0]) && prev[0].length >= 2 ? prev.slice(1) : prev;
        const extra = prev.length === 0 ? [{ w: 'full-configuration', h: 'Show full configuration.' }] : [];
        return [...extra, ...pathCands(pre)];
      }
      case 'get': {
        if (t) return [];
        const prev = args.slice(0, -1);
        const special = treeCands(GET_TREE, prev).filter((x) => !('arg' in x));
        const conf = pathCands(prev);
        const seen = new Set<string>();
        return [...special, ...conf].filter((x) => !seen.has(x.w) && seen.add(x.w));
      }
      case 'diagnose':
        return treeCands(DIAG_TREE, args.slice(0, -1));
      case 'execute':
        return treeCands(EXEC_TREE, args.slice(0, -1));
      case 'edit':
      case 'delete':
      case 'rename':
      case 'clone':
      case 'move': {
        if (!t?.table) return [];
        const keys = t.table.entries.map((e) => ({ w: e.key, h: '' }));
        if (args.length === 1) return cmd === 'edit' ? [{ w: t.pd.key === 'int' ? '<id>' : '<name>', h: 'please input new value (0 = next free id)' }, ...keys] : keys;
        if (args.length === 2) return cmd === 'move' ? [{ w: 'before', h: '' }, { w: 'after', h: '' }] : cmd === 'rename' || cmd === 'clone' ? [{ w: 'to', h: '' }] : [];
        return cmd === 'move' && args.length === 3 ? keys : [];
      }
      case 'set':
      case 'unset':
      case 'append':
      case 'select':
      case 'unselect': {
        if (!t?.fields) return [];
        const fields = t.pd.fields.filter((f) => f.type !== 'table');
        if (args.length <= 1) return fields.map((f) => ({ w: f.name, h: f.help ?? '' }));
        if (cmd === 'unset') return [];
        const fr = resolveWord(args[0], fields.map((f) => f.name));
        if (!isWord(fr)) return [];
        const fd = fields.find((f) => f.name === fr.word)!;
        if (fd.type === 'option' || fd.type === 'options') return fd.options!.map((o) => ({ w: o, h: '' }));
        if (fd.type === 'ref' || fd.type === 'refs') return this.refNames(fd).map((o) => ({ w: o, h: '' }));
        const hint = FIELD_HELP[fd.type];
        return hint ? [{ w: hint.split('    ')[0], h: hint.split('    ')[1] ?? '' }] : [];
      }
    }
    return [];
  }

  help(line: string): string[] {
    const toks = tokenize(line);
    const endsWithSpace = line === '' || /\s$/.test(line);
    const ctx = endsWithSpace ? toks : toks.slice(0, -1);
    const partial = endsWithSpace ? '' : toks[toks.length - 1] ?? '';
    const cands = this.candidates([...ctx, partial]).filter((c) => c.w.startsWith('<') || c.w.startsWith(partial));
    if (!cands.length) return endsWithSpace && ctx.length ? ['<Enter>'] : ['command parse error'];
    const wid = Math.max(16, ...cands.map((c) => c.w.length + 4));
    return cands.map((c) => (c.h ? `${c.w.padEnd(wid)}${c.h}` : c.w));
  }

  /** Tab: complete the current word, cycling through candidates on repeated presses (as FortiOS does). */
  complete(line: string): string {
    if (this.tab && this.tab.result === line && this.tab.cands.length) {
      this.tab.i = (this.tab.i + 1) % this.tab.cands.length;
    } else {
      const toks = tokenize(line);
      const endsWithSpace = line === '' || /\s$/.test(line);
      const ctx = endsWithSpace ? toks : toks.slice(0, -1);
      const partial = endsWithSpace ? '' : toks[toks.length - 1] ?? '';
      const cands = this.candidates([...ctx, partial])
        .map((c) => c.w)
        .filter((w) => !w.startsWith('<') && w.startsWith(partial));
      if (!cands.length) return line;
      this.tab = { result: '', base: ctx, cands, i: 0 };
    }
    const res = [...this.tab.base.map(quoteIfNeeded), quoteIfNeeded(this.tab.cands[this.tab.i])].join(' ') + ' ';
    this.tab.result = res;
    return res;
  }
}

let singleton: CliSession | null = null;
export const getCli = () => (singleton ??= new CliSession());

/** Exposed for tests. */
export const _resetCli = () => {
  singleton = null;
};

export { fmtValue, ipToInt };
