// Derives live network state from the config: link status, addresses, DHCP leases, routing table.
import type { Config } from './types';
import { def, entries, list, str, sub } from './config';
import { inNet, intToIp, ipToInt, netAddr, parseIpMask } from './ip';
import { HOSTS, ISPS, type Host } from './topology';
import { getLab } from './lab';
import { evalTunnels, type TunnelState } from './vpn';
import { evalBgp, evalOspf, type BgpState, type OspfState } from './dynroute';
import { PNUM, type Proto } from './objects';
import { emptySdwan, evalSdwan, sdwanZoneRoutes, type SdwanState } from './sdwan';

export interface IfState {
  name: string;
  type: string;
  role: string;
  alias: string;
  adminUp: boolean;
  link: boolean;
  up: boolean;
  ip: number | null;
  prefix: number;
  ipStr: string;
  mode: string;
  allowaccess: string[];
  parent?: string;
  members: string[];
  memberOf?: string;
  zone?: string;
  dhcpGw?: string;
  remoteIp?: number;
  remotePrefix?: number;
}

export interface HostState {
  host: Host;
  ip?: string;
  ipN?: number;
  prefix: number;
  gw?: string;
  dns?: string;
  logical?: string;
  note: string;
  ok: boolean; // has working L2/L3 config
  dhcp?: boolean;
}

export interface RouteState {
  type: 'connected' | 'static' | 'dhcp' | 'bgp' | 'ospf' | 'policy' | 'sdwan';
  metric?: number;
  sdwanZone?: string;
  net: number;
  prefix: number;
  gateway: string | null;
  device: string;
  distance: number;
  priority: number;
  blackhole: boolean;
  eligible: boolean;
  active: boolean;
  reason?: string;
  seq?: string;
}

export interface Net {
  ifs: Record<string, IfState>;
  ifList: IfState[];
  hosts: HostState[];
  routes: RouteState[];
  zones: Record<string, { members: string[]; intrazone: string }>;
  tunnels: Record<string, TunnelState>;
  bgp: BgpState;
  ospf: OspfState;
  sdwan: SdwanState;
}

export function buildNet(c: Config): Net {
  const I = def('system interface');
  const ifs: Record<string, IfState> = {};
  for (const e of entries(c, 'system interface')) {
    const s = (n: string) => str(I, e.f, n);
    ifs[e.key] = {
      name: e.key,
      type: s('type'),
      role: s('role'),
      alias: s('alias'),
      adminUp: s('status') === 'up',
      link: false,
      up: false,
      ip: null,
      prefix: 0,
      ipStr: '',
      mode: s('mode'),
      allowaccess: list(I, e.f, 'allowaccess'),
      parent: s('interface') || undefined,
      members: [],
    };
  }
  for (const e of entries(c, 'system virtual-switch')) {
    const sw = ifs[e.key];
    if (!sw) continue;
    sw.members = (sub(e.f, 'port')?.entries ?? []).map((p) => p.key).filter((p) => ifs[p]);
    for (const p of sw.members) ifs[p].memberOf = sw.name;
  }
  const list_ = Object.values(ifs);
  for (const i of list_) {
    if (i.type === 'physical') i.link = HOSTS.some((h) => h.segment === i.name) && (i.name !== 'wan2' || !!getLab().wan2Cable);
    else if (i.type === 'tunnel' || i.type === 'loopback') i.link = !entries(c, 'vpn ipsec phase1-interface').some((p) => p.key === i.name);
  }
  for (const i of list_) if (i.type === 'hard-switch') i.link = i.members.some((m) => ifs[m].link && ifs[m].adminUp);
  for (const i of list_) if (i.type === 'vlan') i.link = !!(i.parent && ifs[i.parent]?.link && ifs[i.parent]?.adminUp);
  for (const i of list_) i.up = i.adminUp && i.link;

  for (const e of entries(c, 'system interface')) {
    const i = ifs[e.key];
    if (i.memberOf) continue;
    if (i.mode === 'static') {
      const n = parseIpMask(str(I, e.f, 'ip'));
      if (n && n.ip !== 0) {
        i.ip = n.ip;
        i.prefix = n.prefix;
        i.ipStr = intToIp(n.ip);
      }
      const rn = parseIpMask(str(I, e.f, 'remote-ip'));
      if (i.type === 'tunnel' && rn && rn.ip !== 0) {
        i.remoteIp = rn.ip;
        i.remotePrefix = rn.prefix;
      }
    } else if (i.mode === 'dhcp' && i.up && ISPS[i.name]) {
      const isp = ISPS[i.name];
      i.ip = ipToInt(isp.lease);
      i.prefix = isp.prefix;
      i.ipStr = isp.lease;
      i.dhcpGw = isp.ip;
    }
  }

  const zones: Net['zones'] = {};
  const Z = def('system zone');
  for (const e of entries(c, 'system zone')) {
    const members = list(Z, e.f, 'interface');
    zones[e.key] = { members, intrazone: str(Z, e.f, 'intrazone') };
    for (const m of members) if (ifs[m]) ifs[m].zone = e.key;
  }

  // SD-WAN members belong to their SD-WAN zone; policies reference the zone, not the member.
  const sdwan = evalSdwan(c, ifs);
  for (const m of sdwan.members) {
    if (!m.enabled || !ifs[m.intf]) continue;
    ifs[m.intf].zone = m.zone;
    (zones[m.zone] ??= { members: [], intrazone: 'allow' }).members.push(m.intf);
  }

  // Hosts
  const D = def('system dhcp server');
  const dnsPrimary = str(def('system dns'), c['system dns']?.kind === 'object' ? c['system dns'].f : {}, 'primary');
  const leaseIdx: Record<string, number> = {};
  const hosts: HostState[] = HOSTS.map((h) => {
    if (h.segment === 'internet') return { host: h, ip: h.ip, ipN: ipToInt(h.ip!)!, prefix: 32, note: 'Internet host', ok: true };
    if (h.segment === 'branch') return { host: h, ip: h.ip, ipN: ipToInt(h.ip!)!, prefix: h.prefix ?? 24, gw: h.gw, note: 'Branch office LAN (behind Branch-FGT)', ok: true };
    const port = ifs[h.segment];
    const logical = port?.memberOf ?? h.segment;
    const lif = ifs[logical];
    const linkOk = !!port && port.adminUp && (!port.memberOf || !!lif?.adminUp) && (h.segment !== 'wan2' || !!getLab().wan2Cable);
    if (!linkOk) return { host: h, prefix: 0, logical, note: `No link — port ${h.segment} is administratively down.`, ok: false };
    if (h.addressing === 'static') {
      return { host: h, ip: h.ip, ipN: ipToInt(h.ip!)!, prefix: h.prefix ?? 24, gw: h.gw, dns: h.dns, logical, note: 'Static IP', ok: true };
    }
    const apipa = (why: string): HostState => {
      const n = (leaseIdx['apipa'] = (leaseIdx['apipa'] ?? 0) + 1);
      return { host: h, ip: `169.254.${10 + n}.${20 + n}`, ipN: ipToInt(`169.254.${10 + n}.${20 + n}`)!, prefix: 16, logical, note: `${why} The host self-assigned an APIPA address (169.254.x.x) and has no gateway.`, ok: false, dhcp: true };
    };
    const srv = entries(c, 'system dhcp server').find((e) => str(D, e.f, 'interface') === logical && str(D, e.f, 'status') === 'enable');
    if (!lif?.up || lif.ip === null) return apipa(`DHCP failed: interface ${logical} is down or has no IP address.`);
    if (!srv) return apipa(`DHCP failed: no DHCP server is enabled on interface ${logical}.`);
    const idx = (leaseIdx[logical] = (leaseIdx[logical] ?? -1) + 1);
    let n = 0;
    let leased: number | null = null;
    for (const r of sub(srv.f, 'ip-range')?.entries ?? []) {
      const lo = ipToInt(str(D.fields.find((x) => x.name === 'ip-range')!.sub!, r.f, 'start-ip'));
      const hi = ipToInt(str(D.fields.find((x) => x.name === 'ip-range')!.sub!, r.f, 'end-ip'));
      if (lo === null || hi === null) continue;
      for (let a = lo; a <= hi && leased === null; a++) {
        if (a === lif.ip) continue;
        if (n === idx) leased = a;
        n++;
      }
      if (leased !== null) break;
    }
    if (leased === null) return apipa('DHCP failed: the address range is exhausted or invalid.');
    const gwS = str(D, srv.f, 'default-gateway');
    const maskS = str(D, srv.f, 'netmask');
    const prefix = maskS !== '0.0.0.0' ? parseIpMask(`0.0.0.0 ${maskS}`)?.prefix ?? lif.prefix : lif.prefix;
    const svc = str(D, srv.f, 'dns-service');
    const dns = svc === 'default' ? dnsPrimary : svc === 'local' ? lif.ipStr : str(D, srv.f, 'dns-server1');
    return {
      host: h,
      ip: intToIp(leased),
      ipN: leased,
      prefix,
      gw: gwS !== '0.0.0.0' ? gwS : lif.ipStr,
      dns: dns && dns !== '0.0.0.0' ? dns : undefined,
      logical,
      note: `DHCP lease from FortiGate (${logical})`,
      ok: true,
      dhcp: true,
    };
  });

  const net: Net = { ifs, ifList: list_, hosts, routes: computeRoutes(c, ifs, list_, [], sdwan), zones, tunnels: {}, sdwan, bgp: { enabled: false, as: 0, routerId: '0.0.0.0', neighbors: [] }, ospf: { enabled: false, routerId: '0.0.0.0', interfaces: [], neighbors: [] } };
  // IPsec tunnels come up only if the remote gateway is reachable, and routes via a tunnel need it up.
  net.tunnels = evalTunnels(c, net);
  let changed = false;
  for (const t of Object.values(net.tunnels)) {
    const i = ifs[t.name];
    if (!i) continue;
    i.link = t.up;
    i.up = i.adminUp && i.link;
    changed = true;
  }
  if (changed) net.routes = computeRoutes(c, ifs, list_, [], sdwan);
  // Dynamic routing runs on top of the connected/static table.
  const bgp = evalBgp(c, net);
  const ospf = evalOspf(c, net);
  net.bgp = bgp.state;
  net.ospf = ospf.state;
  if (bgp.routes.length || ospf.routes.length) net.routes = computeRoutes(c, ifs, list_, [...bgp.routes, ...ospf.routes], sdwan);
  return net;
}

function computeRoutes(c: Config, ifs: Record<string, IfState>, list_: IfState[], learned: RouteState[] = [], sdwan: SdwanState = emptySdwan()): RouteState[] {
  const sdwanMember = (n: string) => sdwan.enabled && sdwan.members.some((m) => m.intf === n && m.enabled);
  const I = def('system interface');
  const routes: RouteState[] = learned.map((r) => ({ ...r, eligible: !!ifs[r.device]?.up }));
  for (const cl of Object.values(getLab().sslClients ?? {})) {
    const n = ipToInt(cl.ip);
    if (n !== null && ifs['ssl.root']) routes.push({ type: 'connected', net: n, prefix: 32, gateway: null, device: 'ssl.root', distance: 0, priority: 0, blackhole: false, eligible: true, active: false });
  }
  for (const i of list_) {
    if (i.up && i.ip !== null && !i.memberOf)
      routes.push({ type: 'connected', net: netAddr(i.ip, i.prefix), prefix: i.prefix, gateway: null, device: i.name, distance: 0, priority: 0, blackhole: false, eligible: true, active: false });
    if (i.up && i.remoteIp !== undefined && i.remotePrefix !== undefined && i.remotePrefix < 32)
      routes.push({ type: 'connected', net: netAddr(i.remoteIp, i.remotePrefix), prefix: i.remotePrefix, gateway: null, device: i.name, distance: 0, priority: 0, blackhole: false, eligible: true, active: false });
  }
  for (const e of entries(c, 'system interface')) {
    const i = ifs[e.key];
    if (i.dhcpGw && str(I, e.f, 'defaultgw') === 'enable' && !sdwanMember(i.name))
      routes.push({ type: 'dhcp', net: 0, prefix: 0, gateway: i.dhcpGw, device: i.name, distance: Number(str(I, e.f, 'distance')), priority: Number(str(I, e.f, 'priority')), blackhole: false, eligible: true, active: false });
  }
  const R = def('router static');
  for (const e of entries(c, 'router static')) {
    const s = (n: string) => str(R, e.f, n);
    if (s('status') !== 'enable') continue;
    const dst = parseIpMask(s('dst'));
    if (!dst) continue;
    const blackhole = s('blackhole') === 'enable';
    const zone = list(R, e.f, 'sdwan-zone')[0];
    if (zone) {
      if (sdwan.enabled) routes.push(...sdwanZoneRoutes(sdwan, zone, { type: 'static', net: netAddr(dst.ip, dst.prefix), prefix: dst.prefix, distance: Number(s('distance')), priority: 1, blackhole: false, eligible: true, active: false, seq: e.key }));
      continue;
    }
    const dev = ifs[s('device')];
    const gw = s('gateway');
    const gwN = ipToInt(gw);
    let eligible = true;
    let reason: string | undefined;
    if (!blackhole) {
      if (!dev) {
        eligible = false;
        reason = 'no interface';
      } else if (!dev.up) {
        eligible = false;
        reason = `interface ${dev.name} is down`;
      } else if (gwN && gw !== '0.0.0.0' && (dev.ip === null || !inNet(gwN, dev.ip, dev.prefix))) {
        eligible = false;
        reason = `gateway ${gw} is not in the subnet of ${dev.name}`;
      }
    }
    routes.push({
      type: 'static',
      net: netAddr(dst.ip, dst.prefix),
      prefix: dst.prefix,
      gateway: blackhole || gw === '0.0.0.0' ? null : gw,
      device: blackhole ? 'Null' : s('device'),
      distance: Number(s('distance')),
      priority: Number(s('priority')),
      blackhole,
      eligible,
      active: false,
      reason,
      seq: e.key,
    });
  }
  const best: Record<string, number> = {};
  for (const r of routes) if (r.eligible) best[`${r.net}/${r.prefix}`] = Math.min(best[`${r.net}/${r.prefix}`] ?? 999, r.distance);
  for (const r of routes) {
    r.active = r.eligible && r.distance === best[`${r.net}/${r.prefix}`];
    if (r.eligible && !r.active) r.reason = `higher distance than another route to the same prefix`;
  }

  return routes;
}

/** Longest prefix match over active routes; ties broken by priority; equal-cost routes balanced by source IP. */
export function lookupRoute(net: Net, ipN: number, srcN = 0): RouteState | null {
  let best: RouteState | null = null;
  let ties: RouteState[] = [];
  for (const r of net.routes) {
    if (!r.active || !inNet(ipN, r.net, r.prefix)) continue;
    if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.priority < best.priority)) {
      best = r;
      ties = [r];
    } else if (r.prefix === best.prefix && r.priority === best.priority) ties.push(r);
  }
  return ties.length > 1 ? ties[srcN % ties.length] : best;
}

/** Reverse path forwarding check (loose by default, strict when strict-src-check is enabled). */
export function rpfCheck(net: Net, srcN: number, ingress: string, strict: boolean): boolean {
  if (strict) return lookupRoute(net, srcN)?.device === ingress;
  return net.routes.some((r) => r.active && r.device === ingress && inNet(srcN, r.net, r.prefix));
}

/** Policy routes are checked before the routing table (FortiOS: policy route > SD-WAN rule > routing table). */
export function policyRoute(c: Config, net: Net, ingress: string, srcN: number, dstN: number, proto: Proto, dport: number): RouteState | null {
  const P = def('router policy');
  const inAny = (specs: string[], ip: number) => !specs.length || specs.some((s) => {
    const n = parseIpMask(s);
    return !!n && inNet(ip, n.ip, n.prefix);
  });
  for (const e of entries(c, 'router policy')) {
    const s = (n: string) => str(P, e.f, n);
    if (s('status') !== 'enable') continue;
    const inDev = list(P, e.f, 'input-device');
    if (inDev.length && !inDev.includes(ingress)) continue;
    if (!inAny(list(P, e.f, 'src'), srcN) || !inAny(list(P, e.f, 'dst'), dstN)) continue;
    const pn = Number(s('protocol')) || 0;
    if (pn && pn !== PNUM[proto]) continue;
    if (proto !== 'icmp' && (dport < Number(s('start-port')) || dport > Number(s('end-port')))) continue;
    if (s('action') === 'deny') return null;
    const out = net.ifs[s('output-device')];
    if (!out?.up) continue; // FortiOS skips a policy route whose outgoing interface is down
    const gw = s('gateway');
    return { type: 'policy', net: dstN, prefix: 32, gateway: gw !== '0.0.0.0' ? gw : null, device: out.name, distance: 0, priority: 0, blackhole: false, eligible: true, active: true, seq: e.key };
  }
  return null;
}

export function routeCode(r: RouteState): string {
  if (r.type === 'connected') return 'C';
  if (r.type === 'bgp') return r.prefix === 0 ? 'B*' : 'B';
  if (r.type === 'ospf') return 'O';
  return r.prefix === 0 ? 'S*' : 'S';
}
