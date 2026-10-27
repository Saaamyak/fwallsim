// SD-WAN: members, health checks (Performance SLAs) and rules.
import type { Config, Fields } from './types';
import { def, list, str, sub } from './config';
import { getLab } from './lab';
import { ISPS } from './topology';
import { addrMatches, PNUM, type Proto } from './objects';
import type { IfState, Net, RouteState } from './net';

export interface SdwanMember {
  seq: string;
  intf: string;
  zone: string;
  gateway: string;
  priority: number;
  cost: number;
  enabled: boolean;
  up: boolean; // link up with an IP
  alive: boolean; // up and (if probed) answering health checks
}

export interface HcMember {
  seq: string;
  intf: string;
  alive: boolean;
  latency: number;
  jitter: number;
  loss: number;
  sla: boolean[]; // pass/fail per SLA target (index = id - 1)
}

export interface HealthCheck {
  name: string;
  server: string;
  protocol: string;
  targets: { latency: number; jitter: number; loss: number }[];
  members: HcMember[];
}

export interface SdwanState {
  enabled: boolean;
  zones: string[];
  members: SdwanMember[];
  health: HealthCheck[];
}

const sd = (c: Config): Fields => (c['system sdwan']?.kind === 'object' ? c['system sdwan'].f : {});
const D = () => def('system sdwan');
const subDef = (name: string) => D().fields.find((x) => x.name === name)!.sub!;

/** SD-WAN zone and member names straight from config (for pickers and validation). */
export function sdwanConfig(c: Config): { enabled: boolean; zones: string[]; members: string[] } {
  const f = sd(c);
  const M = subDef('members');
  const members = (sub(f, 'members')?.entries ?? []).map((e) => str(M, e.f, 'interface'));
  const zones = (sub(f, 'zone')?.entries ?? []).map((z) => z.key);
  return { enabled: str(D(), f, 'status') === 'enable', zones: zones.length ? zones : ['virtual-wan-link'], members };
}

export const emptySdwan = (): SdwanState => ({ enabled: false, zones: [], members: [], health: [] });

/** Evaluated from interface state only (before routes), so routes can depend on member liveness. */
export function evalSdwan(c: Config, ifs: Record<string, IfState>): SdwanState {
  const f = sd(c);
  if (str(D(), f, 'status') !== 'enable') return emptySdwan();
  const M = subDef('members');
  const H = subDef('health-check');
  const S = H.fields.find((x) => x.name === 'sla')!.sub!;
  const lab = getLab();
  const zones = (sub(f, 'zone')?.entries ?? []).map((z) => z.key);
  const members: SdwanMember[] = (sub(f, 'members')?.entries ?? []).map((e) => {
    const intf = str(M, e.f, 'interface');
    const i = ifs[intf];
    const gwCfg = str(M, e.f, 'gateway');
    const enabled = str(M, e.f, 'status') === 'enable';
    return {
      seq: e.key,
      intf,
      zone: str(M, e.f, 'zone'),
      gateway: gwCfg !== '0.0.0.0' ? gwCfg : i?.dhcpGw ?? '0.0.0.0',
      priority: Number(str(M, e.f, 'priority')) || 1,
      cost: Number(str(M, e.f, 'cost')) || 0,
      enabled,
      up: enabled && !!i?.up && i.ip !== null,
      alive: enabled && !!i?.up && i.ip !== null,
    };
  });
  const health: HealthCheck[] = (sub(f, 'health-check')?.entries ?? []).map((e) => {
    const seqs = list(H, e.f, 'members');
    const targets = (sub(e.f, 'sla')?.entries ?? []).map((t) => ({ latency: Number(str(S, t.f, 'latency-threshold')), jitter: Number(str(S, t.f, 'jitter-threshold')), loss: Number(str(S, t.f, 'packetloss-threshold')) }));
    const hm: HcMember[] = members
      .filter((m) => !seqs.length || seqs.includes(m.seq))
      .map((m) => {
        const isp = ISPS[m.intf];
        // Probing only the ISP's own gateway cannot see an upstream outage: the gateway still answers.
        const servers = list(H, e.f, 'server');
        const gatewayOnly = !!isp && servers.length > 0 && servers.every((sv) => sv === isp.ip);
        const reach = m.up && !!isp && m.gateway === isp.ip && (gatewayOnly || !lab.ispDown?.[m.intf]);
        const lat = reach ? (lab.ispLatency?.[m.intf] ?? 5) + 0.4 : 0;
        const loss = reach ? lab.ispLoss?.[m.intf] ?? 0 : 100;
        const jitter = reach ? Math.round(lat * 15) / 100 : 0;
        const alive = reach && loss < 100;
        return { seq: m.seq, intf: m.intf, alive, latency: Math.round(lat * 10) / 10, jitter, loss, sla: targets.map((t) => alive && lat <= t.latency && jitter <= t.jitter && loss <= t.loss) };
      });
    return { name: e.key, server: list(H, e.f, 'server').join(', ') || '(none)', protocol: str(H, e.f, 'protocol'), targets, members: hm };
  });
  // A member probed by any health check is dead if every check that probes it fails.
  for (const m of members) {
    const probes = health.flatMap((h) => h.members.filter((x) => x.seq === m.seq));
    if (probes.length && probes.every((p) => !p.alive)) m.alive = false;
  }
  return { enabled: true, zones: zones.length ? zones : ['virtual-wan-link'], members, health };
}

/** Static routes pointing at an SD-WAN zone become one ECMP route per live member. */
export function sdwanZoneRoutes(state: SdwanState, zone: string, base: Omit<RouteState, 'device' | 'gateway'>): RouteState[] {
  return state.members
    .filter((m) => m.zone === zone && m.enabled)
    .map((m) => ({ ...base, device: m.intf, gateway: m.gateway !== '0.0.0.0' ? m.gateway : null, priority: m.priority, eligible: m.alive, reason: m.alive ? undefined : `SD-WAN member ${m.intf} is dead (health check)`, sdwanZone: zone }));
}

export interface SdwanPick {
  route: RouteState;
  rule: string;
  why: string;
}

/** SD-WAN rules: checked after policy routes and before the plain routing table. */
export function sdwanRule(c: Config, net: Net, srcN: number, dstN: number, proto: Proto, dport: number): SdwanPick | null {
  const st = net.sdwan;
  if (!st.enabled) return null;
  const R = subDef('service');
  const RS = R.fields.find((x) => x.name === 'sla')!.sub!;
  for (const e of sub(sd(c), 'service')?.entries ?? []) {
    const s = (n: string) => str(R, e.f, n);
    if (s('status') !== 'enable') continue;
    const dst = list(R, e.f, 'dst');
    const src = list(R, e.f, 'src');
    if (dst.length && !dst.some((a) => addrMatches(c, a, dstN))) continue;
    if (src.length && !src.some((a) => addrMatches(c, a, srcN))) continue;
    const pn = Number(s('protocol')) || 0;
    if (pn && pn !== PNUM[proto]) continue;
    if (proto !== 'icmp' && (dport < Number(s('start-port')) || dport > Number(s('end-port')))) continue;
    const order = list(R, e.f, 'priority-members');
    const cands = (order.length ? order.map((q) => st.members.find((m) => m.seq === q)).filter((m): m is SdwanMember => !!m) : st.members).filter((m) => m.enabled);
    const alive = cands.filter((m) => m.alive);
    const label = `${e.key}${s('name') ? ` "${s('name')}"` : ''}`;
    if (!alive.length) continue;
    const mode = s('mode');
    const hcName = list(R, e.f, 'health-check')[0];
    const hc = st.health.find((h) => h.name === hcName);
    let pick: SdwanMember = alive[0];
    let why = `manual: first live member in the preferred order (${cands.map((m) => m.intf).join(' > ')})`;
    if (mode === 'priority' && hc) {
      const scored = alive.map((m) => ({ m, lat: hc.members.find((x) => x.seq === m.seq)?.latency ?? 9999 })).sort((a, b) => a.lat - b.lat);
      pick = scored[0].m;
      why = `best quality: lowest latency on health check "${hc.name}" (${scored.map((x) => `${x.m.intf} ${x.lat}ms`).join(', ')})`;
    } else if (mode === 'sla' && hc) {
      const slaEntry = (sub(e.f, 'sla')?.entries ?? []).find((x) => x.key === hc.name);
      const id = slaEntry ? Number(str(RS, slaEntry.f, 'id')) || 1 : 1;
      const meets = alive.filter((m) => hc.members.find((x) => x.seq === m.seq)?.sla[id - 1]);
      if (meets.length) {
        pick = meets[0];
        why = `lowest cost (SLA): first member meeting SLA ${id} of "${hc.name}" in order ${cands.map((m) => m.intf).join(' > ')}`;
      } else why = `lowest cost (SLA): no member meets SLA ${id} of "${hc.name}", so the highest-priority live member is used`;
    }
    const route: RouteState = { type: 'sdwan', net: dstN, prefix: 32, gateway: pick.gateway !== '0.0.0.0' ? pick.gateway : null, device: pick.intf, distance: 0, priority: 0, blackhole: false, eligible: true, active: true, seq: label };
    return { route, rule: label, why };
  }
  return null;
}
