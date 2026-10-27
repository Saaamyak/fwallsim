// Dynamic routing: eBGP with the ISP and OSPF with Branch-FGT over the IPsec tunnel.
import type { Config, Fields } from './types';
import { def, list, str, sub } from './config';
import { inNet, intToIp, ipToInt, netAddr, parseIpMask } from './ip';
import type { Net, RouteState } from './net';
import { BRANCH } from './vpn';

/** What the ISP has agreed with you (shown in Lab > WAN & Routing). */
export const ISP_BGP = { ip: '203.0.113.1', as: 64500, customerAs: 65010, routes: ['0.0.0.0/0', '198.51.100.0/24'] };

/** OSPF on Branch-FGT's side of the tunnel. */
export const BRANCH_OSPF = { routerId: '10.20.0.1', ip: '169.254.1.2', localIp: '169.254.1.1', subnet: '169.254.1.0/30', area: '0.0.0.0', hello: 10, dead: 40, routes: [{ prefix: '10.20.0.0/24', cost: 1 }] }; // literal: BRANCH is not initialised yet at module load (import cycle)

export interface BgpNeighbor {
  ip: string;
  remoteAs: number;
  state: 'Idle' | 'Active' | 'Established';
  reason?: string;
  received: string[];
  advertised: string[];
}

export interface BgpState {
  enabled: boolean;
  as: number;
  routerId: string;
  neighbors: BgpNeighbor[];
}

export interface OspfNeighbor {
  routerId: string;
  ip: string;
  intf: string;
  state: 'Down' | 'Init' | 'Full';
  reason?: string;
}

export interface OspfIf {
  name: string;
  ip: string;
  area: string;
  cost: number;
  hello: number;
  dead: number;
}

export interface OspfState {
  enabled: boolean;
  routerId: string;
  interfaces: OspfIf[];
  neighbors: OspfNeighbor[];
}

function objFields(c: Config, path: string): Fields {
  const o = c[path];
  return o?.kind === 'object' ? o.f : {};
}

function autoRouterId(net: Net): string {
  const ips = net.ifList.filter((i) => i.up && i.ip !== null && !i.memberOf).map((i) => i.ip!);
  return ips.length ? intToIp(Math.max(...ips)) : '0.0.0.0';
}

const route = (prefix: string, gateway: string, device: string, type: 'bgp' | 'ospf', distance: number, metric = 0): RouteState => {
  const n = parseIpMask(prefix)!;
  return { type, net: netAddr(n.ip, n.prefix), prefix: n.prefix, gateway, device, distance, priority: 1, blackhole: false, eligible: true, active: false, metric };
};

export function evalBgp(c: Config, net: Net): { state: BgpState; routes: RouteState[] } {
  const B = def('router bgp');
  const f = objFields(c, 'router bgp');
  const as = Number(str(B, f, 'as')) || 0;
  const rid = str(B, f, 'router-id');
  const state: BgpState = { enabled: as > 0, as, routerId: rid !== '0.0.0.0' ? rid : autoRouterId(net), neighbors: [] };
  const routes: RouteState[] = [];
  if (!as) return { state, routes };
  const N = B.fields.find((x) => x.name === 'neighbor')!.sub!;
  const NW = B.fields.find((x) => x.name === 'network')!.sub!;
  const networks = (sub(f, 'network')?.entries ?? []).map((e) => parseIpMask(str(NW, e.f, 'prefix'))).filter((x): x is NonNullable<typeof x> => !!x);
  for (const e of sub(f, 'neighbor')?.entries ?? []) {
    const remoteAs = Number(str(N, e.f, 'remote-as')) || 0;
    const nb: BgpNeighbor = { ip: e.key, remoteAs, state: 'Idle', received: [], advertised: [] };
    state.neighbors.push(nb);
    if (str(N, e.f, 'shutdown') === 'enable') {
      nb.reason = 'Administratively shut down';
      continue;
    }
    const wan = net.ifs['wan1'];
    if (e.key !== ISP_BGP.ip || !wan?.up || wan.ip === null || !inNet(ipToInt(ISP_BGP.ip)!, wan.ip, wan.prefix)) {
      nb.state = 'Active';
      nb.reason = e.key !== ISP_BGP.ip ? `No BGP speaker answers on ${e.key} TCP/179` : 'wan1 is down or not in the ISP subnet';
      continue;
    }
    if (remoteAs !== ISP_BGP.as) {
      nb.reason = `Bad Peer AS: the ISP is AS ${ISP_BGP.as}, but remote-as is ${remoteAs} (NOTIFICATION 2/2 sent)`;
      continue;
    }
    if (as !== ISP_BGP.customerAs) {
      nb.reason = `The ISP expects you to be AS ${ISP_BGP.customerAs}, not AS ${as} (NOTIFICATION 2/2 received)`;
      continue;
    }
    nb.state = 'Established';
    nb.received = [...ISP_BGP.routes];
    // A network statement is only advertised if an exact route exists in the routing table.
    nb.advertised = networks.filter((n) => net.routes.some((r) => r.active && r.type !== 'bgp' && r.net === netAddr(n.ip, n.prefix) && r.prefix === n.prefix)).map((n) => `${intToIp(netAddr(n.ip, n.prefix))}/${n.prefix}`);
    for (const p of ISP_BGP.routes) routes.push(route(p, ISP_BGP.ip, 'wan1', 'bgp', 20));
  }
  return { state, routes };
}

export function evalOspf(c: Config, net: Net): { state: OspfState; routes: RouteState[] } {
  const O = def('router ospf');
  const f = objFields(c, 'router ospf');
  const NW = O.fields.find((x) => x.name === 'network')!.sub!;
  const OI = O.fields.find((x) => x.name === 'ospf-interface')!.sub!;
  const nets = (sub(f, 'network')?.entries ?? []).map((e) => ({ n: parseIpMask(str(NW, e.f, 'prefix')), area: str(NW, e.f, 'area') })).filter((x) => x.n);
  const rid = str(O, f, 'router-id');
  const state: OspfState = { enabled: nets.length > 0, routerId: rid !== '0.0.0.0' ? rid : autoRouterId(net), interfaces: [], neighbors: [] };
  const routes: RouteState[] = [];
  if (!state.enabled) return { state, routes };
  const ifCfg = (name: string) => (sub(f, 'ospf-interface')?.entries ?? []).find((e) => str(OI, e.f, 'interface') === name);
  for (const i of net.ifList) {
    if (!i.up || i.ip === null || i.memberOf) continue;
    const m = nets.find((x) => inNet(i.ip!, x.n!.ip, x.n!.prefix));
    if (!m) continue;
    const ic = ifCfg(i.name);
    state.interfaces.push({ name: i.name, ip: i.ipStr, area: m.area, cost: ic ? Number(str(OI, ic.f, 'cost')) || 1 : 1, hello: ic ? Number(str(OI, ic.f, 'hello-interval')) : 10, dead: ic ? Number(str(OI, ic.f, 'dead-interval')) : 40 });
  }
  // The only OSPF speaker in the lab is Branch-FGT, at the far end of the IPsec tunnel.
  const t = Object.values(net.tunnels).find((x) => x.up && x.remoteGw === BRANCH.publicIp);
  if (!t) return { state, routes };
  const nb: OspfNeighbor = { routerId: BRANCH_OSPF.routerId, ip: BRANCH_OSPF.ip, intf: t.name, state: 'Down' };
  const oi = state.interfaces.find((x) => x.name === t.name);
  const tif = net.ifs[t.name];
  const sn = parseIpMask(BRANCH_OSPF.subnet)!;
  if (!tif?.ip) nb.reason = `Tunnel interface ${t.name} has no IP address (the branch uses ${BRANCH_OSPF.ip}, so set ${BRANCH_OSPF.localIp})`;
  else if (!inNet(tif.ip, sn.ip, sn.prefix) || tif.ipStr === BRANCH_OSPF.ip) nb.reason = `${t.name} is ${tif.ipStr}, not in ${BRANCH_OSPF.subnet} with the branch (${BRANCH_OSPF.ip})`;
  else if (!oi) nb.reason = `OSPF is not enabled on ${t.name}: no network statement covers ${tif.ipStr}`;
  else if (oi.area !== BRANCH_OSPF.area) nb.reason = `Area mismatch: ${t.name} is in area ${oi.area}, the branch uses ${BRANCH_OSPF.area}`;
  else if (oi.hello !== BRANCH_OSPF.hello || oi.dead !== BRANCH_OSPF.dead) {
    nb.state = 'Init';
    nb.reason = `Hello/dead interval mismatch (${oi.hello}/${oi.dead} vs branch ${BRANCH_OSPF.hello}/${BRANCH_OSPF.dead}): hellos are discarded`;
  } else if (state.routerId === BRANCH_OSPF.routerId) nb.reason = `Duplicate router ID ${state.routerId}`;
  else {
    nb.state = 'Full';
    for (const r of BRANCH_OSPF.routes) routes.push(route(r.prefix, BRANCH_OSPF.ip, t.name, 'ospf', 110, oi.cost + r.cost));
  }
  state.neighbors.push(nb);
  return { state, routes };
}

export const bgpNetworks = (c: Config) => {
  const NW = def('router bgp').fields.find((x) => x.name === 'network')!.sub!;
  return (sub(objFields(c, 'router bgp'), 'network')?.entries ?? []).map((e) => str(NW, e.f, 'prefix'));
};

export { list };
