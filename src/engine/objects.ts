// Matching of address, service and schedule objects.
import type { Config } from './types';
import { def, entries, find, list, str } from './config';
import { inNet, ipToInt, parseIpMask } from './ip';
import { HOSTS, resolveName } from './topology';

export type Proto = 'tcp' | 'udp' | 'icmp';
export const PNUM: Record<Proto, number> = { tcp: 6, udp: 17, icmp: 1 };

export function countryOf(ipN: number): string {
  const h = HOSTS.find((x) => x.ip && ipToInt(x.ip) === ipN);
  if (h) return h.country;
  const a = ipN >>> 24;
  if (a === 10 || a === 127 || (a === 192 && ((ipN >>> 16) & 255) === 168) || (a === 172 && ((ipN >>> 20) & 15) === 1)) return 'Reserved';
  return 'United States';
}

export function addrMatches(c: Config, name: string, ipN: number, depth = 0): boolean {
  if (depth > 8) return false;
  const a = find(c, 'firewall address', name);
  if (a) {
    const A = def('firewall address');
    const s = (n: string) => str(A, a.f, n);
    switch (s('type')) {
      case 'ipmask': {
        const n = parseIpMask(s('subnet'));
        return !!n && inNet(ipN, n.ip, n.prefix);
      }
      case 'iprange': {
        const lo = ipToInt(s('start-ip'));
        const hi = ipToInt(s('end-ip'));
        return lo !== null && hi !== null && ipN >= lo && ipN <= hi;
      }
      case 'fqdn': {
        const ip = resolveName(s('fqdn'));
        return ip !== null && ipToInt(ip) === ipN;
      }
      case 'geography':
        return countryOf(ipN) === s('country');
      default:
        return false;
    }
  }
  const g = find(c, 'firewall addrgrp', name);
  if (g) return list(def('firewall addrgrp'), g.f, 'member').some((m) => addrMatches(c, m, ipN, depth + 1));
  return false;
}

export function vipInList(c: Config, names: string[], vipName: string): boolean {
  return names.some((n) => {
    if (n === vipName) return true;
    const g = find(c, 'firewall vipgrp', n);
    return !!g && list(def('firewall vipgrp'), g.f, 'member').includes(vipName);
  });
}

export function portInSpec(spec: string, port: number): boolean {
  const dst = spec.split(':')[0];
  const parts = dst.split('-');
  const lo = Number(parts[0]);
  const hi = parts[1] !== undefined ? Number(parts[1]) : lo;
  return port >= lo && port <= hi;
}

export function serviceMatches(c: Config, name: string, proto: Proto, dport: number, depth = 0): boolean {
  if (depth > 8) return false;
  const s = find(c, 'firewall service custom', name);
  if (s) {
    const S = def('firewall service custom');
    const p = str(S, s.f, 'protocol');
    if (p === 'IP') {
      const n = Number(str(S, s.f, 'protocol-number') || '0');
      return n === 0 || n === PNUM[proto];
    }
    if (p === 'ICMP') {
      if (proto !== 'icmp') return false;
      const t = str(S, s.f, 'icmptype');
      return t === '' || t === '8';
    }
    if (p === 'TCP/UDP/SCTP') {
      const ranges = proto === 'tcp' ? list(S, s.f, 'tcp-portrange') : proto === 'udp' ? list(S, s.f, 'udp-portrange') : [];
      return ranges.some((r) => portInSpec(r, dport));
    }
    return false;
  }
  const g = find(c, 'firewall service group', name);
  if (g) return list(def('firewall service group'), g.f, 'member').some((m) => serviceMatches(c, m, proto, dport, depth + 1));
  return false;
}

/** Best-known service name for a flow, as shown in traffic logs. */
export function guessService(c: Config, proto: Proto, dport: number): string {
  if (proto === 'icmp') return 'PING';
  const S = def('firewall service custom');
  for (const e of entries(c, 'firewall service custom')) {
    if (e.key.startsWith('ALL') || str(S, e.f, 'protocol') !== 'TCP/UDP/SCTP') continue;
    if (serviceMatches(c, e.key, proto, dport)) return e.key;
  }
  return `${proto}/${dport}`;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseDateTime(s: string): number {
  const m = /^(\d{1,2}):(\d{2}) (\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s.trim());
  if (!m) return NaN;
  return new Date(+m[3], +m[4] - 1, +m[5], +m[1], +m[2]).getTime();
}

export function scheduleMatches(c: Config, name: string, now: Date, depth = 0): boolean {
  if (!name) return true;
  if (depth > 4) return false;
  const r = find(c, 'firewall schedule recurring', name);
  if (r) {
    const R = def('firewall schedule recurring');
    const days = list(R, r.f, 'day');
    if (!days.includes(DAY_NAMES[now.getDay()])) return false;
    const start = str(R, r.f, 'start');
    const end = str(R, r.f, 'end');
    if (start === end) return true;
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return start < end ? hm >= start && hm < end : hm >= start || hm < end;
  }
  const o = find(c, 'firewall schedule onetime', name);
  if (o) {
    const O = def('firewall schedule onetime');
    const t = now.getTime();
    return t >= parseDateTime(str(O, o.f, 'start')) && t <= parseDateTime(str(O, o.f, 'end'));
  }
  const g = find(c, 'firewall schedule group', name);
  if (g) return list(def('firewall schedule group'), g.f, 'member').some((m) => scheduleMatches(c, m, now, depth + 1));
  return false;
}
