// The packet engine. Follows the FortiOS first-packet flow:
// ingress -> session lookup -> DNAT (VIP) -> local-in? -> route lookup -> RPF -> policy -> SNAT -> UTM -> egress
// and produces a human "Packet Walk" plus "diagnose debug flow" style trace lines.
import type { Config } from './types';
import { gobj, glist } from './config';
import { inNet, intToIp, ipToInt, isIp, isPrivate, parseIpMask, parseIpRange, parsePortRange } from './ip';
import { buildNet, lookupRoute, policyRoute, rpfCheck, type HostState, type IfState, type Net, type RouteState } from './net';
import { addrMatches, countryOf, guessService, PNUM, scheduleMatches, serviceMatches, vipInList, type Proto } from './objects';
import { hex8, type PacketEvent, type Runtime, type SimResult, type Step, type TrafficLog } from './runtime';
import { GENERIC_INTERNET, ISPS, resolveName, type Listen } from './topology';
import { ippools, policies, vips, type PolicyView } from './views';
import { getLab, type SslClient } from './lab';
import { BRANCH, selectorFor, sslTunnels } from './vpn';
import { sdwanRule } from './sdwan';
import { snmpAllows } from './mgmt';
import { def as cdef, entries as centries, list as clist, str as cstr } from './config';

export interface TrafficRequest {
  srcHost: string;
  dst: string;
  proto: Proto;
  dport: number;
  sport?: number;
  label?: string;
}

interface Pkt {
  proto: Proto;
  src: string;
  srcN: number;
  sport: number;
  dst: string;
  dstN: number;
  dport: number;
}

interface Target {
  name: string;
  listen: Listen[];
  ping: boolean;
  country: string;
  state?: HostState;
}

interface Outcome {
  ok: boolean;
  summary: string;
}

interface Ctx {
  c: Config;
  net: Net;
  rt: Runtime;
  now: number;
  steps: Step[];
  dbg: string[];
  traceId: number;
  prefix: string;
  pk: PacketEvent[];
  t: number;
}

type Tuple = { proto: Proto; src: string; sport: number; dst: string; dport: number };

function ev(ctx: Ctx, intf: string, dir: 'in' | 'out', p: Tuple, flag: PacketEvent['flag']) {
  ctx.t += 0.05 + Math.random() * (dir === 'in' && flag !== 'req' ? 18 : 0.4);
  ctx.pk.push({ t: ctx.t, intf, dir, proto: flag === 'unreach' ? 'icmp' : p.proto, src: p.src, sport: p.sport, dst: p.dst, dport: p.dport, flag });
}

const ispIpN = (seg: string) => (ISPS[seg] ? ipToInt(ISPS[seg].ip)! : -1);
const ispTarget = (seg: string): Target => ({ name: ISPS[seg].host, listen: [], ping: true, country: 'Reserved' });
const ispDown = (seg: string) => !!getLab().ispDown?.[seg];

// ---------- helpers ----------

function step(ctx: Ctx, stage: string, status: Step['status'], title: string, detail: string, extra: { hint?: string; lines?: string[] } = {}) {
  ctx.steps.push({ stage, status, title: ctx.prefix + title, detail, ...extra });
}

function D(ctx: Ctx, func: string, line: number, msg: string) {
  ctx.dbg.push(`id=65308 trace_id=${ctx.traceId} func=${func} line=${line} msg="${msg}"`);
}

const fail = (summary: string): Outcome => ({ ok: false, summary });
const eph = () => 49152 + Math.floor(Math.random() * 16000);
const rnd = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo));
const protoLabel = (p: Pkt) => (p.proto === 'icmp' ? 'ICMP echo' : `${p.proto.toUpperCase()}/${p.dport}`);

function tupleStr(p: { proto: Proto; src: string; sport: number; dst: string; dport: number }) {
  if (p.proto === 'icmp') return `${p.src}:${p.sport}->${p.dst}:2048`;
  return `${p.src}:${p.sport}->${p.dst}:${p.dport}`;
}

function pktLine(ctx: Ctx, p: { proto: Proto; src: string; sport: number; dst: string; dport: number }, intf: string, reply: boolean, rst = false) {
  const tail =
    p.proto === 'tcp'
      ? `flag [${rst ? 'R.' : reply ? 'S.' : 'S'}], seq ${rnd(1e8, 4e9)}, ack ${reply ? rnd(1e8, 4e9) : 0}, win ${reply ? 65160 : 64240}`
      : p.proto === 'icmp'
        ? `type=${reply ? 0 : 8}, code=0, id=${p.sport}, seq=1.`
        : '';
  D(ctx, 'print_pkt_detail', 5895, `vd-root:0 received a packet(proto=${PNUM[p.proto]}, ${tupleStr(p)}) tun_id=0.0.0.0 from ${intf}. ${tail}`.trim());
}

function respond(t: Target, proto: Proto, port: number): 'ok' | 'refused' | 'unreachable' | 'silent' {
  if (proto === 'icmp') return t.ping ? 'ok' : 'silent';
  if (t.listen.some((l) => l.proto === proto && l.port === port)) return 'ok';
  return proto === 'tcp' ? 'refused' : 'unreachable';
}

function volume(proto: Proto, port: number, resp: string) {
  if (resp === 'none') return { sent: proto === 'tcp' ? 60 : 84, rcvd: 0, sp: 1, rp: 0 };
  if (resp === 'refused') return { sent: 60, rcvd: 40, sp: 1, rp: 1 };
  if (resp === 'unreachable') return { sent: 74, rcvd: 102, sp: 1, rp: 1 };
  if (proto === 'icmp') return { sent: 84, rcvd: 84, sp: 1, rp: 1 };
  if (proto === 'udp' && port === 53) return { sent: rnd(60, 80), rcvd: rnd(90, 180), sp: 1, rp: 1 };
  if (port === 443) {
    const sent = rnd(1500, 4500);
    const rcvd = rnd(15000, 95000);
    return { sent, rcvd, sp: Math.ceil(sent / 500), rp: Math.ceil(rcvd / 1400) };
  }
  if (port === 80) {
    const sent = rnd(600, 1600);
    const rcvd = rnd(4000, 40000);
    return { sent, rcvd, sp: Math.ceil(sent / 400), rp: Math.ceil(rcvd / 1400) };
  }
  return { sent: rnd(400, 3000), rcvd: rnd(400, 6000), sp: rnd(4, 12), rp: rnd(4, 12) };
}

function targetFor(net: Net, ipN: number): Target {
  const h = net.hosts.find((x) => x.ipN === ipN && x.host.segment === 'internet');
  if (h) return { name: h.host.name, listen: h.host.listen, ping: h.host.ping, country: h.host.country, state: h };
  return { name: intToIp(ipN), ...GENERIC_INTERNET };
}

function hostTarget(h: HostState): Target {
  return { name: h.host.name, listen: h.host.listen, ping: h.host.ping, country: h.host.country, state: h };
}

/** Who answers ARP for an address on the ISP segment (wan1)? */
function wanOwner(ctx: Ctx, ipN: number, seg = 'wan1'): string | null {
  const wan = ctx.net.ifs[seg];
  if (!wan?.up || wan.ip === null) return null;
  if (wan.ip === ipN) return `the ${seg} interface address`;
  for (const v of vips(ctx.c)) {
    const r = parseIpRange(v.extip);
    if (v.arpReply && (v.extintf === 'any' || v.extintf === seg) && r && ipN >= r[0] && ipN <= r[1] && inNet(ipN, wan.ip, wan.prefix)) return `VIP ${v.name}`;
  }
  for (const p of ippools(ctx.c)) {
    const lo = ipToInt(p.startip);
    const hi = ipToInt(p.endip);
    if (p.arpReply && lo !== null && hi !== null && ipN >= lo && ipN <= hi && inNet(ipN, wan.ip!, wan.prefix)) return `IP pool ${p.name}`;
  }
  return null;
}

interface VipHit {
  name: string;
  mappedIp: string;
  mappedPort: number;
}

export function findVip(c: Config, ingress: string, proto: Proto, dstN: number, dport: number): VipHit | null {
  for (const v of vips(c)) {
    if (v.extintf !== 'any' && v.extintf !== ingress) continue;
    const ext = parseIpRange(v.extip);
    if (!ext || dstN < ext[0] || dstN > ext[1]) continue;
    const map = parseIpRange(v.mappedip);
    if (!map) continue;
    const mapped = intToIp(map[0] + (dstN - ext[0]));
    if (v.portforward) {
      if (v.protocol !== proto) continue;
      const ep = parsePortRange(v.extport);
      if (!ep || dport < ep[0] || dport > ep[1]) continue;
      const mp = parsePortRange(v.mappedport || v.extport) ?? ep;
      return { name: v.name, mappedIp: mapped, mappedPort: mp[0] + (dport - ep[0]) };
    }
    return { name: v.name, mappedIp: mapped, mappedPort: dport };
  }
  return null;
}

// ---------- policy matching ----------

export interface MatchQuery {
  srcintf: string;
  dstintf: string;
  srcN: number;
  dstN: number;
  proto: Proto;
  dport: number;
  vip?: string;
}

export interface MatchResult {
  policy?: PolicyView;
  intrazone?: boolean;
  authRequired?: boolean;
  trace: string[];
}

function ifMatch(net: Net, list: string[], iface: string) {
  return list.includes('any') || list.includes(iface) || (!!net.ifs[iface]?.zone && list.includes(net.ifs[iface].zone!));
}

function mismatch(c: Config, net: Net, p: PolicyView, q: MatchQuery, now: Date): string | null {
  if (!p.status) return 'policy is disabled';
  const zin = net.ifs[q.srcintf]?.zone;
  const zout = net.ifs[q.dstintf]?.zone;
  if (!ifMatch(net, p.srcintf, q.srcintf)) return `incoming interface ${q.srcintf}${zin ? ` (zone ${zin})` : ''} is not in [${p.srcintf.join(', ')}]`;
  if (!ifMatch(net, p.dstintf, q.dstintf)) return `outgoing interface ${q.dstintf}${zout ? ` (zone ${zout})` : ''} is not in [${p.dstintf.join(', ')}]`;
  let m = p.srcaddr.some((a) => addrMatches(c, a, q.srcN));
  if (p.srcaddrNegate) m = !m;
  if (!m) return `source ${intToIp(q.srcN)} is ${p.srcaddrNegate ? '' : 'not '}in [${p.srcaddr.join(', ')}]${p.srcaddrNegate ? ' (negated)' : ''}`;
  if (q.vip) {
    m = vipInList(c, p.dstaddr, q.vip);
    if (p.dstaddrNegate) m = !m;
    if (!m) return `traffic was translated by VIP "${q.vip}", but the destination [${p.dstaddr.join(', ')}] does not include that VIP`;
  } else {
    m = p.dstaddr.some((a) => addrMatches(c, a, q.dstN));
    if (p.dstaddrNegate) m = !m;
    if (!m) return `destination ${intToIp(q.dstN)} is ${p.dstaddrNegate ? '' : 'not '}in [${p.dstaddr.join(', ')}]${p.dstaddrNegate ? ' (negated)' : ''}`;
  }
  m = p.service.some((s) => serviceMatches(c, s, q.proto, q.dport));
  if (p.serviceNegate) m = !m;
  if (!m) return `service ${q.proto === 'icmp' ? 'ICMP' : `${q.proto.toUpperCase()}/${q.dport}`} is not in [${p.service.join(', ')}]`;
  if (!scheduleMatches(c, p.schedule, now)) return `schedule "${p.schedule}" is not active right now`;
  if (p.groups.length || p.users.length) {
    const au = getLab().auth[intToIp(q.srcN)];
    if (!au || au.expires < now.getTime()) return AUTH;
    if (!p.users.includes(au.user) && !au.groups.some((g) => p.groups.includes(g)))
      return `authenticated user "${au.user}" (groups: ${au.groups.join(', ') || 'none'}) is not in [${[...p.users, ...p.groups].join(', ')}]`;
  }
  return null;
}

const AUTH = '__auth__';
const AUTH_PORTS: Record<string, number> = { http: 80, https: 443, ftp: 21, telnet: 23 };

export function matchPolicy(c: Config, net: Net, q: MatchQuery, now: Date): MatchResult {
  const trace: string[] = [];
  for (const p of policies(c)) {
    const why = mismatch(c, net, p, q, now);
    const label = `Policy ${p.id}${p.name ? ` "${p.name}"` : ''}`;
    if (why === AUTH) {
      const types = glist(c, 'user setting', 'auth-type');
      const canPrompt = q.proto === 'tcp' && types.some((t) => AUTH_PORTS[t] === q.dport);
      if (canPrompt) {
        trace.push(`${label}: matches, but requires user authentication and ${intToIp(q.srcN)} has not logged in → redirect to the authentication portal`);
        return { policy: p, authRequired: true, trace };
      }
      trace.push(`${label}: no match, because the source is not authenticated (${q.proto.toUpperCase()}/${q.dport} cannot show a login page, so the policy is skipped)`);
      continue;
    }
    if (why) {
      trace.push(`${label}: no match, because ${why}`);
      continue;
    }
    trace.push(`${label}: MATCH → ${p.action.toUpperCase()}`);
    return { policy: p, trace };
  }
  const zin = net.ifs[q.srcintf]?.zone;
  if (zin && zin === net.ifs[q.dstintf]?.zone && net.zones[zin]?.intrazone === 'allow') {
    trace.push(`Both interfaces are in zone "${zin}" and intra-zone traffic is allowed.`);
    return { intrazone: true, trace };
  }
  trace.push('Nothing matched, so the Implicit Deny (policy 0) applies.');
  return { trace };
}

// ---------- logging / sessions ----------

function roleOf(net: Net, intf: string) {
  return net.ifs[intf]?.role ?? 'undefined';
}

function addLog(ctx: Ctx, l: Omit<TrafficLog, 'id' | 'time' | 'level' | 'srcintfrole' | 'dstintfrole' | 'srccountry' | 'dstcountry'>) {
  const srcN = ipToInt(l.srcip)!;
  const dstN = ipToInt(l.dstip)!;
  ctx.rt.trafficLogs = [
    {
      ...l,
      id: ++ctx.rt.seq.log,
      time: ctx.now,
      level: l.action === 'deny' ? 'warning' : 'notice',
      srcintfrole: roleOf(ctx.net, l.srcintf),
      dstintfrole: roleOf(ctx.net, l.dstintf),
      srccountry: countryOf(srcN),
      dstcountry: countryOf(dstN),
    },
    ...ctx.rt.trafficLogs,
  ].slice(0, 2000);
}

function bumpIf(ctx: Ctx, intf: string, rx: number, tx: number, rxp: number, txp: number) {
  const s = ctx.rt.ifStats[intf] ?? { rxB: 0, txB: 0, rxP: 0, txP: 0 };
  ctx.rt.ifStats[intf] = { rxB: s.rxB + rx, txB: s.txB + tx, rxP: s.rxP + rxp, txP: s.txP + txp };
}

function hit(ctx: Ctx, pid: string, bytes: number) {
  const s = ctx.rt.policyStats[pid] ?? { hits: 0, bytes: 0 };
  ctx.rt.policyStats[pid] = { hits: s.hits + 1, bytes: s.bytes + bytes, first: s.first ?? ctx.now, last: ctx.now };
}

// ---------- the simulation ----------

export function runTraffic(c: Config, rt0: Runtime, req: TrafficRequest): Runtime {
  const rt: Runtime = {
    ...rt0,
    sessions: [...rt0.sessions],
    trafficLogs: rt0.trafficLogs,
    policyStats: { ...rt0.policyStats },
    ifStats: { ...rt0.ifStats },
    seq: { ...rt0.seq },
  };
  const ctx: Ctx = { c, net: buildNet(c), rt, now: Date.now(), steps: [], dbg: [], traceId: 0, prefix: '', pk: [], t: 0 };
  const out = simulate(ctx, req);
  rt.history = [
    { id: ++rt.seq.result, time: ctx.now, label: req.label ?? `${req.proto.toUpperCase()} ${req.dst}`, ok: out.ok, summary: out.summary, steps: ctx.steps, debug: ctx.dbg, packets: ctx.pk },
    ...rt0.history,
  ].slice(0, 40);
  return rt;
}

function simulate(ctx: Ctx, req: TrafficRequest): Outcome {
  const src = ctx.net.hosts.find((h) => h.host.id === req.srcHost);
  if (!src) return fail('Unknown source host');
  if (!src.ok || src.ipN === undefined) {
    step(ctx, 'host', 'fail', `${src.host.name} has no working network configuration`, src.note, {
      hint: src.dhcp ? 'Check that the LAN interface is up, has an IP address, and that its DHCP Server is enabled (Network > Interfaces > edit the interface).' : 'Bring the port up under Network > Interfaces.',
    });
    return fail(`${src.host.name}: ${src.note}`);
  }
  step(
    ctx,
    'host',
    'info',
    `${src.host.name} builds the packet`,
    `Host IP ${src.ip}/${src.prefix}${src.gw ? `, default gateway ${src.gw}` : ''}${src.dns ? `, DNS server ${src.dns}` : ''}. (${src.note})`,
  );

  let dst = req.dst.trim();
  if (!isIp(dst)) {
    const name = dst.toLowerCase();
    if (!src.dns) {
      step(ctx, 'dns', 'fail', 'No DNS server configured', `${src.host.name} has no DNS server, so it cannot resolve ${name}.`);
      return fail(`No DNS server on ${src.host.name}`);
    }
    step(ctx, 'dns', 'info', `Name lookup for ${name}`, `Before connecting, ${src.host.name} must resolve ${name} by sending a DNS query (UDP/53) to ${src.dns}.`);
    const saved = ctx.prefix;
    ctx.prefix = '[DNS] ';
    const sub = simulate(ctx, { srcHost: req.srcHost, dst: src.dns, proto: 'udp', dport: 53 });
    ctx.prefix = saved;
    if (!sub.ok) {
      step(ctx, 'dns', 'fail', 'DNS lookup failed', `The DNS query to ${src.dns} failed: ${sub.summary}`, {
        hint: 'Browsing by name needs DNS first. Make sure a policy allows DNS (UDP/53) from this host to its DNS server.',
      });
      return fail(`DNS lookup for ${name} failed: ${sub.summary}`);
    }
    const ip = resolveName(name);
    if (!ip) {
      step(ctx, 'dns', 'fail', `DNS: ${name} does not exist (NXDOMAIN)`, 'The DNS server answered that this name is unknown.');
      return fail(`${name}: NXDOMAIN`);
    }
    step(ctx, 'dns', 'ok', `DNS answer: ${name} → ${ip}`, 'Name resolved; now the real connection starts.');
    dst = ip;
  }

  const pkt: Pkt = { proto: req.proto, src: src.ip!, srcN: src.ipN, sport: req.proto === 'icmp' ? rnd(1, 999) : req.sport ?? eph(), dst, dstN: ipToInt(dst)!, dport: req.proto === 'icmp' ? 0 : req.dport };
  if (src.host.segment === 'branch') return fromBranch(ctx, src, pkt);
  const ssl = getLab().sslClients?.[src.host.id];
  if (ssl && sslTunnels(ctx.c, ssl.portal, pkt.dstN)) return fromSsl(ctx, src, pkt, ssl);
  return src.host.segment === 'internet' ? fromInternet(ctx, src, pkt) : fromInside(ctx, src, pkt);
}

const HQ_NET = parseIpMask(BRANCH.p2.remote)!;
const BR_NET = parseIpMask(BRANCH.lan)!;

/** Traffic from the branch LAN: through the tunnel if it is for HQ, otherwise out the branch's own internet. */
function fromBranch(ctx: Ctx, src: HostState, pkt: Pkt): Outcome {
  if (inNet(pkt.dstN, BR_NET.ip, BR_NET.prefix)) {
    step(ctx, 'l2', 'fail', `ARP for ${pkt.dst} failed`, 'No other device on the branch LAN has that address.');
    return fail(`No device ${pkt.dst} on the branch LAN`);
  }
  if (!inNet(pkt.dstN, HQ_NET.ip, HQ_NET.prefix)) {
    step(ctx, 'l2', 'info', 'Branch-FGT sends it to the internet', `${pkt.dst} is not HQ (${BRANCH.p2.remote}), so the branch firewall NATs it to ${BRANCH.publicIp} and routes it to its ISP. It never enters the VPN.`);
    if (isPrivate(pkt.dstN)) {
      step(ctx, 'delivery', 'fail', 'Private destination on the internet', `${pkt.dst} is not routable on the internet.`);
      return fail(`${pkt.dst} is private and not reachable from the branch`);
    }
    return fromInternet(ctx, src, { ...pkt, src: BRANCH.publicIp, srcN: ipToInt(BRANCH.publicIp)! });
  }
  const t = Object.values(ctx.net.tunnels).find((x) => x.up && selectorFor(x, pkt.dstN, pkt.srcN));
  if (!t) {
    const any = Object.values(ctx.net.tunnels)[0];
    step(ctx, 'l2', 'fail', 'Branch-FGT has no working tunnel to HQ', `The branch sends ${BRANCH.p2.remote} into its IPsec tunnel, but the tunnel is down${any?.error ? `: ${any.error}` : ' (no tunnel configured on HQ)'}.`, {
      hint: 'Configure VPN > IPsec Tunnels on HQ to match the branch settings (Lab > VPN), and check the tunnel shows Up.',
    });
    return fail('Site-to-site VPN is down');
  }
  step(ctx, 'l2', 'ok', `Branch-FGT encrypts the packet into the tunnel`, `ESP from ${BRANCH.publicIp} to ${t.localGw}. The HQ FortiGate decrypts it and it appears on tunnel interface "${t.name}".`);
  return firewall(ctx, src, pkt, t.name);
}

/** Remote laptop with FortiClient connected: the inner packet appears on ssl.root with the tunnel IP. */
function fromSsl(ctx: Ctx, src: HostState, pkt: Pkt, cl: SslClient): Outcome {
  step(ctx, 'l2', 'ok', 'FortiClient sends it through the SSL-VPN tunnel', `Inner packet ${cl.ip} → ${pkt.dst} (split tunneling decided this destination goes into the tunnel). Outer packet: TLS from ${src.ip} to the FortiGate. It appears on interface ssl.root.`);
  return firewall(ctx, src, { ...pkt, src: cl.ip, srcN: ipToInt(cl.ip)! }, 'ssl.root');
}

function fromInside(ctx: Ctx, src: HostState, pkt: Pkt): Outcome {
  const lif = ctx.net.ifs[src.logical!];
  if (inNet(pkt.dstN, src.ipN!, src.prefix)) {
    if (lif?.up && lif.ip === pkt.dstN) {
      step(ctx, 'l2', 'ok', `${pkt.dst} is on the local subnet`, `The destination is the FortiGate's own ${lif.name} address, reached directly over the LAN.`);
      return firewall(ctx, src, pkt, lif.name);
    }
    const peer = ctx.net.hosts.find((h) => h !== src && h.ok && h.ipN === pkt.dstN && h.logical === src.logical);
    if (peer) {
      step(ctx, 'l2', 'info', 'Same subnet: delivered directly by the switch', `${peer.host.name} is on the same subnet and layer-2 segment (${lif?.name}). The frame is switched, not routed through the firewall, so no firewall policy applies.`, {
        hint: 'Ports in a hardware switch act like an ordinary switch. Traffic between them is never inspected by firewall policies.',
      });
      return direct(ctx, src, hostTarget(peer), pkt);
    }
    step(ctx, 'l2', 'fail', `ARP for ${pkt.dst} failed`, `${pkt.dst} is in the host's own subnet, but no device on that segment answered ARP.`);
    return fail(`No device with IP ${pkt.dst} on the local segment`);
  }
  if (!src.gw) {
    step(ctx, 'l2', 'fail', 'No default gateway', `${pkt.dst} is outside ${src.ip}/${src.prefix} and the host has no default gateway.`);
    return fail('Host has no default gateway');
  }
  if (!lif || !lif.up || lif.ip !== ipToInt(src.gw)) {
    step(
      ctx,
      'l2',
      'fail',
      `Default gateway ${src.gw} does not answer`,
      lif && lif.ip !== null ? `The FortiGate interface on this segment is ${lif.name} (${lif.ipStr}), but the host is using ${src.gw} as its gateway.` : `Interface ${src.logical} is down or has no IP address.`,
      { hint: "The host's gateway must be the FortiGate interface IP on that segment. Did you change the interface IP without updating the host or DHCP settings?" },
    );
    return fail(`Gateway ${src.gw} unreachable (ARP failed)`);
  }
  step(ctx, 'l2', 'ok', `Sent to default gateway ${src.gw} (FortiGate ${lif.name})`, `${pkt.dst} is outside ${src.ip}/${src.prefix}, so the host sends the frame to its gateway's MAC address.`);
  return firewall(ctx, src, pkt, lif.name);
}

function fromInternet(ctx: Ctx, src: HostState, pkt: Pkt): Outcome {
  if (isPrivate(pkt.dstN)) {
    step(ctx, 'l2', 'fail', 'Internet routers drop private destinations', `${pkt.dst} is a private (RFC 1918) address. It cannot be routed on the internet, so the packet never reaches your FortiGate.`, {
      hint: 'To make an internal server reachable from outside, publish it with a Virtual IP (Policy & Objects > Virtual IPs) on the WAN address.',
    });
    return fail(`${pkt.dst} is private and not routable on the internet`);
  }
  for (const [seg, isp] of Object.entries(ISPS)) {
    if (!inNet(pkt.dstN, ipToInt(isp.net)!, isp.prefix)) continue;
    if (pkt.dstN === ispIpN(seg)) {
      step(ctx, 'l2', 'info', `Destination is ${isp.host}`, 'Delivered by the ISP without passing through your FortiGate.');
      return direct(ctx, src, ispTarget(seg), pkt);
    }
    if (ispDown(seg)) {
      step(ctx, 'l2', 'fail', `${isp.name} outage`, `${isp.name}'s upstream network is down, so traffic for ${isp.net}/${isp.prefix} never reaches your FortiGate.`);
      return fail(`${isp.name} outage: ${pkt.dst} unreachable from the internet`);
    }
    const owner = wanOwner(ctx, pkt.dstN, seg);
    if (!owner) {
      step(ctx, 'l2', 'fail', `Nobody answers for ${pkt.dst}`, `${isp.host} sent an ARP request for ${pkt.dst} on the ${seg} segment and no device replied.`, {
        hint: `The FortiGate answers ARP only for its ${seg} IP, VIP external IPs (ARP reply enabled) and IP pool addresses. Is ${seg} up with an IP address?`,
      });
      return fail(`No device owns ${pkt.dst} on the ${isp.name} segment`);
    }
    step(ctx, 'l2', 'ok', `${isp.name} delivers the packet to FortiGate ${seg}`, `The FortiGate answered ARP for ${pkt.dst} (${owner}).`);
    return firewall(ctx, src, pkt, seg);
  }
  step(ctx, 'l2', 'info', 'Internet-to-internet traffic', `${pkt.dst} is not part of your network. The packet crosses the internet without touching your FortiGate.`);
  return direct(ctx, src, targetFor(ctx.net, pkt.dstN), pkt);
}

/** Delivery that does not traverse the firewall. */
function direct(ctx: Ctx, src: HostState, t: Target, pkt: Pkt): Outcome {
  const r = respond(t, pkt.proto, pkt.dport);
  if (r === 'ok') {
    step(ctx, 'delivery', 'ok', `${t.name} answers`, `${protoLabel(pkt)} reply returned to ${src.host.name}.`);
    return { ok: true, summary: `${t.name} replied (${protoLabel(pkt)}). Traffic did not pass through the firewall.` };
  }
  const why = r === 'refused' ? `TCP port ${pkt.dport} is closed (RST)` : r === 'unreachable' ? `UDP port ${pkt.dport} unreachable` : 'host does not answer ping';
  step(ctx, 'delivery', 'fail', `${t.name}: ${why}`, 'The destination host itself rejected or ignored the request.');
  return fail(`${t.name}: ${why}`);
}

function localService(c: Config, p: Pkt): string | null {
  if (p.proto === 'icmp') return 'ping';
  if (p.proto === 'tcp') {
    if (p.dport === Number(gobj(c, 'system global', 'admin-sport'))) return 'https';
    if (p.dport === Number(gobj(c, 'system global', 'admin-port'))) return 'http';
    if (p.dport === Number(gobj(c, 'system global', 'admin-ssh-port'))) return 'ssh';
    if (p.dport === Number(gobj(c, 'system global', 'admin-telnet-port'))) return 'telnet';
    if (p.dport === 541) return 'fgfm';
  }
  if (p.proto === 'udp' && p.dport === 161) return 'snmp';
  return null;
}

/** First matching user-defined local-in policy (checked before Administrative Access). */
function localInPolicy(ctx: Ctx, intf: string, pkt: Pkt): { id: string; action: string } | null {
  const L = cdef('firewall local-in-policy');
  for (const e of centries(ctx.c, 'firewall local-in-policy')) {
    const s = (n: string) => cstr(L, e.f, n);
    if (s('status') !== 'enable') continue;
    const i = s('intf');
    if (i && i !== 'any' && i !== intf && ctx.net.ifs[intf]?.zone !== i) continue;
    const src = clist(L, e.f, 'srcaddr');
    const dst = clist(L, e.f, 'dstaddr');
    const svc = clist(L, e.f, 'service');
    if (!src.some((a) => addrMatches(ctx.c, a, pkt.srcN))) continue;
    if (!dst.some((a) => addrMatches(ctx.c, a, pkt.dstN))) continue;
    if (!svc.some((x) => serviceMatches(ctx.c, x, pkt.proto, pkt.dport))) continue;
    if (!scheduleMatches(ctx.c, s('schedule'), new Date(ctx.now))) continue;
    return { id: e.key, action: s('action') };
  }
  return null;
}

const SVC_LABEL: Record<string, string> = { ping: 'PING', https: 'HTTPS (admin GUI)', http: 'HTTP (admin GUI)', ssh: 'SSH (admin CLI)', telnet: 'TELNET', fgfm: 'FMG-Access', snmp: 'SNMP' };

function localIn(ctx: Ctx, src: HostState, pkt: Pkt, inIf: IfState, own: IfState, sid: number): Outcome {
  const { c } = ctx;
  step(ctx, 'local', 'info', 'Destination is the FortiGate itself (local-in)', `${pkt.dst} belongs to interface ${own.name}. Traffic to the FortiGate is not matched against firewall policies. It is controlled by Administrative Access on the ingress interface (${inIf.name}) and by local-in policies.`);
  const svc = localService(c, pkt);
  const lip = localInPolicy(ctx, inIf.name, pkt);
  const allowed = svc !== null && inIf.allowaccess.includes(svc) && lip?.action !== 'deny';
  const logOn = gobj(c, 'log setting', allowed ? 'local-in-allow' : 'local-in-deny-unicast') === 'enable';
  const base = {
    subtype: 'local' as const,
    srcip: pkt.src,
    srcport: pkt.sport,
    srcintf: inIf.name,
    srcname: src.host.name,
    dstip: pkt.dst,
    dstport: pkt.dport,
    dstintf: 'root',
    proto: PNUM[pkt.proto],
    service: svc ? svc.toUpperCase() : guessService(c, pkt.proto, pkt.dport),
    policyid: 0,
    policyname: '',
    policyuuid: '',
    sessionid: sid,
    trandisp: 'noop',
    duration: 0,
  };
  if (lip) step(ctx, 'local', lip.action === 'deny' ? 'fail' : 'info', `Local-in policy ${lip.id}: ${lip.action.toUpperCase()}`, lip.action === 'deny' ? `Local-in policy ${lip.id} matches (${inIf.name}, ${pkt.src} → ${pkt.dst}, ${protoLabel(pkt)}) and denies it. Local-in policies are checked before Administrative Access, so this blocks the traffic even if the service is enabled on the interface.` : `Local-in policy ${lip.id} matches and accepts. The service must still be enabled in Administrative Access.`);
  if (lip?.action === 'deny') {
    D(ctx, 'fw_local_in_handler', 424, `iprope_in_check() check failed on policy ${lip.id}, drop`);
    if (logOn) addLog(ctx, { ...base, policyid: Number(lip.id), action: 'deny', sentbyte: 0, rcvdbyte: 0, sentpkt: 1, rcvdpkt: 0 });
    return fail(`Blocked by local-in policy ${lip.id}`);
  }
  if (allowed && svc === 'snmp' && !snmpAllows(c, pkt.srcN)) {
    D(ctx, 'fw_local_in_handler', 474, 'iprope_in_check() check success, policy-0, local-in to snmpd');
    step(ctx, 'local', 'fail', 'SNMP agent ignores the request', `SNMP is allowed on ${inIf.name}, but the SNMP agent is disabled or no community allows ${pkt.src}. SNMP requests from unknown managers are silently dropped.`, { hint: 'Configure System > SNMP: enable the agent and add a community with this host.' });
    return fail(`SNMP request from ${pkt.src} ignored (no matching community/host)`);
  }
  if (!allowed) {
    D(ctx, 'fw_local_in_handler', 424, 'iprope_in_check() check failed on policy 0, drop');
    step(
      ctx,
      'local',
      'fail',
      svc ? `${SVC_LABEL[svc]} is not allowed on ${inIf.name}` : `FortiGate has no service on ${protoLabel(pkt)}`,
      svc ? `Administrative access on ${inIf.name} is [${inIf.allowaccess.join(', ') || 'none'}], so the packet is dropped.` : 'Nothing on the FortiGate listens on that port, so the packet is dropped.',
      { hint: svc ? `Enable ${svc.toUpperCase()} under Network > Interfaces > ${inIf.name} > Administrative Access.` : undefined },
    );
    if (logOn) addLog(ctx, { ...base, action: 'deny', sentbyte: 0, rcvdbyte: 0, sentpkt: 1, rcvdpkt: 0 });
    return fail(svc ? `${svc.toUpperCase()} to ${pkt.dst} denied: not enabled in Administrative Access of ${inIf.name}` : `No FortiGate service on ${protoLabel(pkt)}`);
  }
  D(ctx, 'fw_local_in_handler', 474, `iprope_in_check() check success, policy-0, local-in to ${own.name}`);
  ev(ctx, inIf.name, 'out', { proto: pkt.proto, src: pkt.dst, sport: pkt.dport, dst: pkt.src, dport: pkt.sport }, 'rep');
  step(ctx, 'local', 'ok', `${SVC_LABEL[svc!]} allowed on ${inIf.name}`, `${svc!.toUpperCase()} is enabled in Administrative Access of ${inIf.name}.`);
  const reply = svc === 'ping' ? 'Echo reply sent.' : svc === 'http' && gobj(c, 'system global', 'admin-https-redirect') === 'enable' ? 'HTTP is redirected to the HTTPS login page.' : 'The FortiGate login prompt is served.';
  step(ctx, 'reply', 'ok', `FortiGate answers ${src.host.name}`, reply);
  if (logOn) addLog(ctx, { ...base, action: 'accept', sentbyte: 84, rcvdbyte: 84, sentpkt: 1, rcvdpkt: 1 });
  return { ok: true, summary: `FortiGate ${own.name} (${pkt.dst}) answered ${SVC_LABEL[svc!]}` };
}

function describeRoute(r: RouteState) {
  if (r.type === 'connected') return `Connected route ${intToIp(r.net)}/${r.prefix} on ${r.device}`;
  if (r.sdwanZone) return `SD-WAN route ${intToIp(r.net)}/${r.prefix} (zone ${r.sdwanZone}) via member ${r.device}${r.gateway ? ` gw ${r.gateway}` : ''} [distance ${r.distance}]`;
  if (r.type === 'policy') return `Policy route ${r.seq} matched (checked before the routing table): out ${r.device}${r.gateway ? ` via ${r.gateway}` : ''}`;
  if (r.type === 'bgp') return `BGP-learned route ${intToIp(r.net)}/${r.prefix} via ${r.gateway} on ${r.device} [distance ${r.distance}]`;
  if (r.type === 'ospf') return `OSPF-learned route ${intToIp(r.net)}/${r.prefix} via ${r.gateway} on ${r.device} [distance ${r.distance}, metric ${r.metric}]`;
  return `${r.type === 'dhcp' ? 'DHCP-learned' : 'Static'} route ${intToIp(r.net)}/${r.prefix} via ${r.gateway ?? 'direct'} on ${r.device} [distance ${r.distance}, priority ${r.priority}]`;
}

function firewall(ctx: Ctx, src: HostState, pkt: Pkt, ingress: string): Outcome {
  const { c, net } = ctx;
  const inIf = net.ifs[ingress];
  ctx.traceId = ++ctx.rt.seq.trace;
  pktLine(ctx, pkt, ingress, false);
  ev(ctx, ingress, 'in', pkt, 'req');
  step(ctx, 'ingress', 'ok', `Ingress: packet arrives on ${ingress}`, `${pkt.proto.toUpperCase()} ${pkt.src}:${pkt.sport} → ${pkt.dst}${pkt.proto === 'icmp' ? '' : ':' + pkt.dport}`);

  const sid = ++ctx.rt.seq.session;
  D(ctx, 'init_ip_session_common', 6076, `allocate a new session-${hex8(sid)}, tun_id=0.0.0.0`);
  step(ctx, 'session', 'info', `Session lookup: new session ${hex8(sid)}`, 'No existing session matches this connection (5-tuple), so this is the first packet. It goes through the full checks: DNAT, routing, then policy. Later packets of the session take the fast path.');

  // DNAT
  const vip = findVip(c, ingress, pkt.proto, pkt.dstN, pkt.dport);
  let dst = pkt.dst;
  let dstN = pkt.dstN;
  let dport = pkt.dport;
  if (vip) {
    dst = vip.mappedIp;
    dstN = ipToInt(dst)!;
    dport = vip.mappedPort;
    D(ctx, 'get_new_addr', 1219, `find DNAT: IP-${dst}, port-${dport}`);
    step(ctx, 'dnat', 'ok', `Destination NAT by Virtual IP "${vip.name}"`, `${pkt.dst}${pkt.proto === 'icmp' ? '' : ':' + pkt.dport} → ${dst}${pkt.proto === 'icmp' ? '' : ':' + dport}. DNAT happens before the route lookup, so routing uses the real server address.`);
  } else {
    step(ctx, 'dnat', 'skip', 'Destination NAT: none', 'No Virtual IP matches this destination.');
  }

  // Local-in
  if (!vip) {
    const own = net.ifList.find((i) => i.ip === pkt.dstN && i.up && !i.memberOf);
    if (own) return localIn(ctx, src, pkt, inIf, own, sid);
  }

  // Routing: policy routes first, then the routing table
  const pr = policyRoute(c, net, ingress, pkt.srcN, dstN, pkt.proto, dport);
  if (pr) D(ctx, 'vf_ip_route_input_common', 2605, `Match policy routing id=${pr.seq}: to ${pr.gateway ?? dst} via ifindex-${pr.device}`);
  const table = lookupRoute(net, dstN, pkt.srcN);
  // SD-WAN rules apply only when the routing table would send the flow over SD-WAN.
  const overSdwan = !!table && net.sdwan.enabled && net.sdwan.members.some((m) => m.intf === table.device && m.enabled);
  const sw = !pr && overSdwan ? sdwanRule(c, net, pkt.srcN, dstN, pkt.proto, dport) : null;
  if (sw) D(ctx, 'vf_ip_route_input_common', 2605, `Match SD-WAN rule ${sw.rule}: to ${sw.route.gateway ?? dst} via ifindex-${sw.route.device}`);
  const r = pr ?? sw?.route ?? table;
  if (!r) {
    D(ctx, 'vf_ip_route_input_common', 2605, 'no matching route, drop');
    step(ctx, 'route', 'fail', `Route lookup: no route to ${dst}`, 'The routing table has no route (not even a default route) covering this destination.', {
      hint: 'Check Dashboard > Network > Routing. Is wan1 up and getting its default route by DHCP? Or add one under Network > Static Routes.',
    });
    return fail(`No route to ${dst}`);
  }
  if (r.blackhole) {
    D(ctx, 'vf_ip_route_input_common', 2605, 'find a route: flag=00000000 gw-0.0.0.0 via blackhole, drop');
    step(ctx, 'route', 'fail', 'Route lookup: blackhole route', `${describeRoute(r)} silently discards traffic.`);
    return fail(`Blackhole route for ${dst}`);
  }
  D(ctx, 'vf_ip_route_input_common', 2605, `find a route: flag=04000000 gw-${r.gateway ?? dst} via ${r.device}`);
  step(ctx, 'route', 'ok', `Route lookup: out via ${r.device}`, r.type === 'sdwan' && sw ? `SD-WAN rule ${sw.rule} matched: ${sw.why} → ${r.device}${r.gateway ? ` via ${r.gateway}` : ''}.` : overSdwan && !pr ? `${describeRoute(r)}. No SD-WAN rule matched, so the implicit rule load-balances by source IP over the live SD-WAN members.` : r.type === 'policy' ? `${describeRoute(r)}. The routing table is not consulted for this flow.` : `${describeRoute(r)}. This is the longest-prefix active route for ${dst}, so the egress interface is ${r.device}.`);

  const strict = gobj(c, 'system settings', 'strict-src-check') === 'enable';
  if (!rpfCheck(net, pkt.srcN, ingress, strict)) {
    D(ctx, 'ip_route_input_slowpath', 2155, 'reverse path check fail, drop');
    step(ctx, 'rpf', 'fail', 'Reverse path check failed (anti-spoofing)', `The FortiGate has no ${strict ? 'best ' : ''}route back to the source ${pkt.src} via the ingress interface ${ingress}. A packet that arrives on an interface the FortiGate would not use to reach the sender is treated as spoofed.`, {
      hint: 'Add a route back to the source through the ingress interface, or check your default route.',
    });
    return fail(`Reverse path check failed for ${pkt.src} on ${ingress}`);
  }
  step(ctx, 'rpf', 'ok', 'Reverse path (anti-spoofing) check passed', `A route back to ${pkt.src} exists through ${ingress}${strict ? ' (strict mode)' : ' (loose mode)'}.`);

  const egress = r.device;
  const pm = matchPolicy(c, net, { srcintf: ingress, dstintf: egress, srcN: pkt.srcN, dstN, proto: pkt.proto, dport, vip: vip?.name }, new Date(ctx.now));
  const svcName = guessService(c, pkt.proto, dport);

  if (pm.authRequired && pm.policy) {
    const port = Number(gobj(c, 'user setting', 'auth-port-https')) || 1003;
    D(ctx, 'fw_forward_handler', 881, `Allowed by Policy-${pm.policy.id}: AUTH`);
    D(ctx, 'iprope_dnat_check', 5341, `redirect to authentication portal ${inIf.ipStr}:${port}`);
    step(ctx, 'policy', 'fail', `Authentication required by policy ${pm.policy.id} "${pm.policy.name}"`, `This policy only allows users in [${[...pm.policy.users, ...pm.policy.groups].join(', ')}]. ${pkt.src} has not logged in, so the FortiGate intercepts the web request and redirects the browser to its login page https://${inIf.ipStr}:${port}/fgtauth.`, {
      lines: pm.trace,
      hint: 'Log in from the Lab panel > Users tab (as if typing credentials into the portal), then send the traffic again.',
    });
    return fail(`Login required: redirected to the FortiGate authentication portal (policy ${pm.policy.id})`);
  }
  if (!pm.intrazone && (!pm.policy || pm.policy.action !== 'accept')) {
    const p = pm.policy;
    const pid = p ? p.id : '0';
    D(ctx, 'fw_forward_handler', 771, `Denied by forward policy check (policy ${pid})`);
    step(ctx, 'policy', 'fail', p ? `Denied by policy ${pid} "${p.name}"` : 'Denied by Implicit Deny (policy 0)', `Policies are checked top to bottom, and the first match wins. Traffic: ${ingress} → ${egress}, ${pkt.src} → ${dst}, ${svcName}.`, {
      lines: pm.trace,
      hint: p ? undefined : `Create a policy from ${ingress} to ${egress} that matches this traffic (Policy & Objects > Firewall Policy).${vip ? ` For VIP traffic, the policy destination must be the VIP "${vip.name}".` : ''}`,
    });
    if (p) hit(ctx, pid, 0);
    const logOn = p ? p.logtraffic !== 'disable' : gobj(c, 'log setting', 'fwpolicy-implicit-log') === 'enable';
    if (logOn)
      addLog(ctx, {
        subtype: 'forward',
        action: 'deny',
        srcip: pkt.src,
        srcport: pkt.sport,
        srcintf: ingress,
        srcname: src.host.name,
        dstip: pkt.dst,
        dstport: pkt.dport,
        dstintf: egress,
        proto: PNUM[pkt.proto],
        service: svcName,
        policyid: Number(pid),
        policyname: p?.name ?? '',
        policyuuid: p?.uuid ?? '',
        sessionid: sid,
        trandisp: vip ? 'dnat' : 'noop',
        tranip: vip ? dst : undefined,
        tranport: vip ? dport : undefined,
        duration: 0,
        sentbyte: 0,
        rcvdbyte: 0,
        sentpkt: 1,
        rcvdpkt: 0,
        msg: 'Denied by forward policy check',
      });
    return fail(p ? `Denied by policy ${pid} (${p.name})` : `Denied by implicit deny: no policy allows ${ingress} → ${egress} ${svcName}`);
  }

  const pol = pm.policy;
  const pid = pol ? pol.id : '0';
  // SNAT
  let tsrc = pkt.src;
  let tsport = pkt.sport;
  let natNote = '';
  if (pol?.nat) {
    const pool = pol.ippool ? ippools(c).find((p) => pol.poolname.includes(p.name)) : undefined;
    if (pool) {
      const lo = ipToInt(pool.startip) ?? 0;
      const hi = ipToInt(pool.endip) ?? lo;
      if (pool.type === 'one-to-one') {
        tsrc = intToIp(Math.min(hi, lo + (pkt.srcN % (hi - lo + 1))));
        natNote = `IP pool "${pool.name}" (one-to-one): source port kept`;
      } else {
        tsrc = pool.startip;
        tsport = pol.fixedport ? pkt.sport : rnd(60000, 65000);
        natNote = `IP pool "${pool.name}" (${pool.type})`;
      }
    } else {
      tsrc = net.ifs[egress]?.ipStr || '0.0.0.0';
      tsport = pol.fixedport ? pkt.sport : rnd(60000, 65000);
      natNote = `outgoing interface address of ${egress}`;
    }
  }
  D(ctx, 'fw_forward_handler', 881, pm.intrazone ? 'Allowed by intra-zone policy' : `Allowed by Policy-${pid}:${pol?.nat ? ' SNAT' : ''}`);
  step(ctx, 'policy', 'ok', pm.intrazone ? 'Allowed: intra-zone traffic' : `Allowed by policy ${pid} "${pol!.name}"`, `Policies are checked top to bottom, and the first match wins. Traffic: ${ingress} → ${egress}, ${pkt.src} → ${dst}, ${svcName}.`, { lines: pm.trace });
  if (pol?.nat) {
    D(ctx, '__ip_session_run_tuple', 3497, `SNAT ${pkt.src}->${tsrc}:${tsport}`);
    step(ctx, 'snat', 'ok', `Source NAT: ${pkt.src}:${pkt.sport} → ${tsrc}:${tsport}`, `NAT is enabled on the policy and uses ${natNote}.`);
  } else {
    step(ctx, 'snat', 'skip', 'Source NAT: disabled', 'NAT is off on this policy, so the original source IP is kept.');
  }
  if (vip) D(ctx, '__ip_session_run_tuple', 3484, `DNAT ${pkt.dst}:${pkt.dport}->${dst}:${dport}`);
  step(ctx, 'utm', 'skip', 'Security profiles: none applied', 'Antivirus, web filter, IPS and application control are planned for v1.1.');

  // Egress + next hop
  const nh = r.gateway ?? dst;
  const nhN = ipToInt(nh)!;
  const tsrcN = ipToInt(tsrc)!;
  let target: Target | null = null;
  let deadReply: string | null = null;
  let deadHint: string | undefined;

  const tun = net.tunnels[egress];
  if (tun) {
    const sel = selectorFor(tun, tsrcN, dstN);
    if (!sel) {
      D(ctx, 'ipsecdev_hard_start_xmit', 669, 'no matching IPsec selector, drop');
      step(ctx, 'egress', 'fail', `No IPsec selector matches ${tsrc} → ${dst}`, `Tunnel "${egress}" only carries ${tun.p2.filter((p) => p.up).map((p) => `${fmtNet(p.src)} → ${fmtNet(p.dst)}`).join(', ') || 'nothing (no phase 2 is up)'}.`, {
        hint: pol?.nat ? 'NAT is enabled on this policy, so the source was changed and no longer matches the phase 2 selector. Disable NAT on VPN policies.' : 'Check the phase 2 local/remote subnets.',
      });
      return fail(`Dropped: no matching IPsec selector for ${tsrc} → ${dst}`);
    }
    D(ctx, 'ipsecdev_hard_start_xmit', 669, `enter IPSec interface-${egress}`);
    D(ctx, 'esp_output4', 905, 'IPsec encrypt/auth');
    D(ctx, 'ipsec_output_finish', 622, `send to ${tun.remoteGw} via intf-${tun.outIntf}`);
    step(ctx, 'egress', 'ok', `Egress: encrypted into IPsec tunnel "${egress}"`, `Matches phase 2 selector "${sel.name}". Sent as ESP from ${tun.localGw} to ${tun.remoteGw} out ${tun.outIntf}. Branch-FGT decrypts it and forwards it on its LAN.`);
    const bh = net.hosts.find((h) => h.host.segment === 'branch' && h.ipN === dstN);
    if (!bh) {
      step(ctx, 'delivery', 'fail', `No host ${dst} at the branch`, 'The branch LAN has no device with that address.');
      return fail(`No host ${dst} at the branch`);
    }
    target = hostTarget(bh);
  } else if (ISPS[egress] && nhN === ispIpN(egress)) {
    const isp = ISPS[egress];
    step(ctx, 'egress', 'ok', `Egress: out ${egress} to ${isp.host}`, `Next hop ${nh} (${isp.name}).`);
    if (dstN === ispIpN(egress)) target = ispTarget(egress);
    else if (ispDown(egress)) {
      step(ctx, 'delivery', 'fail', `${isp.name} outage: the packet goes nowhere`, `${egress} is still physically up and ${isp.host} still answers ARP, but ${isp.name}'s upstream is down. The FortiGate cannot see this from link status alone, so it keeps sending traffic here.`, {
        hint: 'Use SD-WAN with a Performance SLA (health check to an internet server) or a link monitor, so the FortiGate detects the outage and moves traffic to another link.',
      });
      return fail(`${isp.name} outage: no internet via ${egress}`);
    } else if (isPrivate(dstN)) {
      step(ctx, 'delivery', 'fail', 'ISP drops the packet', `${dst} is a private address and is not routable on the internet.`);
      return fail(`ISP dropped packet to private address ${dst}`);
    } else target = targetFor(net, dstN);
    if (isPrivate(tsrcN)) {
      deadReply = `The packet left with private source ${tsrc}. Internet routers cannot route replies back to a private (RFC 1918) address, so the reply is lost.`;
      deadHint = 'Enable NAT on the policy so the source becomes the wan1 public address.';
    } else if (!wanOwner(ctx, tsrcN, egress)) {
      deadReply = `Replies are sent to ${tsrc}, but ${isp.name} only delivers ${isp.net}/${isp.prefix} to your ${egress}, and nothing on that segment answers ARP for ${tsrc}.`;
      deadHint = 'An IP pool must use addresses from the WAN subnet with ARP reply enabled, or be routed to you by the ISP.';
    }
  } else {
    const nhHost = net.hosts.find((h) => h.ok && h.ipN === nhN && h.logical === egress);
    if (!nhHost) {
      step(ctx, 'egress', 'fail', `ARP for next hop ${nh} on ${egress} failed`, `The FortiGate tried to resolve ${nh} on ${egress}, but no device answered.`, {
        hint: ISPS[egress] ? `Your route gateway on ${egress} must be the ISP router (${ISPS[egress].ip}).` : 'Check that the destination host exists, is up, and is in the subnet of the egress interface.',
      });
      return fail(`Next hop ${nh} on ${egress} did not answer ARP`);
    }
    if (nhHost.ipN !== dstN) {
      step(ctx, 'egress', 'fail', `${nhHost.host.name} is not a router`, `The route sends ${dst} to ${nh}, but that host does not forward packets.`);
      return fail(`${nhHost.host.name} does not route packets`);
    }
    step(ctx, 'egress', 'ok', `Egress: out ${egress} to ${nhHost.host.name}`, `Destination ${dst} is directly connected on ${egress}.`);
    target = hostTarget(nhHost);
    if (!inNet(tsrcN, nhHost.ipN!, nhHost.prefix) && nhHost.gw !== net.ifs[egress]?.ipStr) {
      deadReply = `${nhHost.host.name} sends its reply to its own gateway ${nhHost.gw ?? '(none)'}, not to the FortiGate (${net.ifs[egress]?.ipStr}). The reply never comes back.`;
      deadHint = "Fix the server's default gateway, or enable NAT so the server replies to the FortiGate's own address.";
    }
  }

  ev(ctx, egress, 'out', { proto: pkt.proto, src: tsrc, sport: tsport, dst, dport }, 'req');
  const resp = respond(target!, pkt.proto, dport);
  const baseLog = {
    subtype: 'forward' as const,
    srcip: pkt.src,
    srcport: pkt.sport,
    srcintf: ingress,
    srcname: src.host.name,
    dstip: pkt.dst,
    dstport: pkt.dport,
    dstintf: egress,
    proto: PNUM[pkt.proto],
    service: svcName,
    policyid: Number(pid),
    policyname: pol?.name ?? '',
    policyuuid: pol?.uuid ?? '',
    sessionid: sid,
    trandisp: pol?.nat && vip ? 'snat+dnat' : pol?.nat ? 'snat' : vip ? 'dnat' : 'noop',
    transip: pol?.nat ? tsrc : undefined,
    transport: pol?.nat ? tsport : undefined,
    tranip: vip ? dst : undefined,
    tranport: vip ? dport : undefined,
  };
  const logAll = pol?.logtraffic === 'all';
  const sess = (state: string, ttl: number, sent: number, rcvd: number) =>
    ctx.rt.sessions.unshift({
      id: sid,
      proto: pkt.proto,
      src: pkt.src,
      sport: pkt.sport,
      dst: pkt.dst,
      dport: pkt.dport,
      srcintf: ingress,
      dstintf: egress,
      policyid: Number(pid),
      state,
      created: ctx.now,
      ttl,
      natSrc: pol?.nat ? tsrc : undefined,
      natSport: pol?.nat ? tsport : undefined,
      dnatDst: vip ? dst : undefined,
      dnatPort: vip ? dport : undefined,
      sentbyte: sent,
      rcvdbyte: rcvd,
      srcname: src.host.name,
    });

  if (deadReply || resp === 'silent') {
    const v = volume(pkt.proto, dport, 'none');
    step(ctx, 'delivery', resp === 'silent' ? 'fail' : 'ok', resp === 'silent' ? `${target!.name} does not answer` : `Packet delivered to ${target!.name}`, resp === 'silent' ? 'The destination ignores ICMP echo requests.' : 'The destination received the request and replied.');
    if (deadReply) step(ctx, 'reply', 'fail', 'The reply never comes back', deadReply, { hint: deadHint });
    sess(pkt.proto === 'tcp' ? 'syn_sent' : 'may_dirty', pkt.proto === 'tcp' ? 10 : 30, v.sent, 0);
    hit(ctx, pid, v.sent);
    bumpIf(ctx, ingress, v.sent, 0, 1, 0);
    bumpIf(ctx, egress, 0, v.sent, 0, 1);
    if (logAll) addLog(ctx, { ...baseLog, action: 'timeout', duration: 10, sentbyte: v.sent, rcvdbyte: 0, sentpkt: v.sp, rcvdpkt: 0 });
    return fail(deadReply ? `Request left through policy ${pid}, but the reply cannot return` : `${target!.name} did not answer`);
  }

  // Reply leg
  ctx.traceId = ++ctx.rt.seq.trace;
  const replyTuple = { proto: pkt.proto, src: dst, sport: dport, dst: tsrc, dport: tsport };
  pktLine(ctx, replyTuple, egress, true, resp === 'refused');
  const rflag = resp === 'refused' ? 'rst' : resp === 'unreachable' ? 'unreach' : 'rep';
  ev(ctx, egress, 'in', replyTuple, rflag);
  D(ctx, 'resolve_ip_tuple_fast', 5976, `Find an existing session, id-${hex8(sid)}, reply direction`);
  const lines: string[] = [];
  if (pol?.nat) {
    D(ctx, '__ip_session_run_tuple', 3511, `DNAT ${tsrc}:${tsport}->${pkt.src}:${pkt.sport}`);
    lines.push(`Reverse SNAT: destination ${tsrc}:${tsport} → ${pkt.src}:${pkt.sport}`);
  }
  if (vip) {
    D(ctx, '__ip_session_run_tuple', 3497, `SNAT ${dst}->${pkt.dst}:${pkt.dport}`);
    lines.push(`Reverse DNAT: source ${dst} → ${pkt.dst}`);
  }
  D(ctx, 'vf_ip_route_input_common', 2605, `find a route: flag=00000000 gw-${pkt.src} via ${ingress}`);
  ev(ctx, ingress, 'out', { proto: pkt.proto, src: pkt.dst, sport: pkt.dport, dst: pkt.src, dport: pkt.sport }, rflag);

  const v = volume(pkt.proto, dport, resp);
  hit(ctx, pid, v.sent + v.rcvd);
  bumpIf(ctx, ingress, v.sent, v.rcvd, v.sp, v.rp);
  bumpIf(ctx, egress, v.rcvd, v.sent, v.rp, v.sp);

  if (resp === 'ok') {
    step(ctx, 'delivery', 'ok', `${target!.name} answers`, `${protoLabel({ ...pkt, dport })} is open on ${target!.name}.`);
    step(ctx, 'reply', 'ok', `Reply matches session ${hex8(sid)}: no policy check`, 'Stateful inspection: the reply is recognised as part of an existing session. It is allowed automatically and the NAT is reversed. No inbound policy is needed for replies.', { lines });
    step(ctx, 'reply', 'ok', `${src.host.name} receives the reply`, `${pkt.proto.toUpperCase()} exchange complete: ${v.sent} bytes sent, ${v.rcvd} bytes received.`);
    sess(pkt.proto === 'tcp' ? 'established' : 'may_dirty', pkt.proto === 'tcp' ? 3600 : pkt.proto === 'udp' ? 180 : 60, v.sent, v.rcvd);
    if (logAll) addLog(ctx, { ...baseLog, action: pkt.proto === 'tcp' ? 'close' : 'accept', duration: pkt.proto === 'tcp' ? rnd(1, 30) : 0, sentbyte: v.sent, rcvdbyte: v.rcvd, sentpkt: v.sp, rcvdpkt: v.rp });
    return { ok: true, summary: `${src.host.name} → ${target!.name} ${protoLabel({ ...pkt, dport })}: delivered and answered, ${pm.intrazone ? 'allowed intra-zone' : `allowed by policy ${pid}`}` };
  }
  const why = resp === 'refused' ? `TCP port ${dport} is closed on ${target!.name}: it answered with a RST` : `UDP port ${dport} is closed on ${target!.name}: ICMP port unreachable`;
  step(ctx, 'delivery', 'fail', `${target!.name} rejects the connection`, `${why}. The firewall allowed it; the server refused it.`, { hint: 'The firewall did its job. The service is not running on the destination.' });
  step(ctx, 'reply', 'info', 'Rejection returned through the session', 'The RST/ICMP error still matches the session and is passed back to the client.', { lines });
  sess('close', 10, v.sent, v.rcvd);
  if (logAll) addLog(ctx, { ...baseLog, action: resp === 'refused' ? 'server-rst' : 'accept', duration: 0, sentbyte: v.sent, rcvdbyte: v.rcvd, sentpkt: v.sp, rcvdpkt: v.rp });
  return fail(why);
}

// ---------- Policy Lookup tool (GUI) ----------

export interface LookupQuery {
  srcintf: string;
  proto: Proto;
  src: string;
  dst: string;
  dport: number;
}

export function policyLookup(c: Config, q: LookupQuery): { policyId?: string; message: string; trace: string[] } {
  const net = buildNet(c);
  const srcN = ipToInt(q.src);
  const dstN0 = ipToInt(q.dst);
  if (srcN === null || dstN0 === null) return { message: 'Enter valid source and destination IP addresses.', trace: [] };
  const vip = findVip(c, q.srcintf, q.proto, dstN0, q.dport);
  const dstN = vip ? ipToInt(vip.mappedIp)! : dstN0;
  const r = lookupRoute(net, dstN);
  if (!r) return { message: `No route to ${intToIp(dstN)}, so there is no egress interface.`, trace: [] };
  const pm = matchPolicy(c, net, { srcintf: q.srcintf, dstintf: r.device, srcN, dstN, proto: q.proto, dport: vip ? vip.mappedPort : q.dport, vip: vip?.name }, new Date());
  const pre = `${q.srcintf} → ${r.device}${vip ? ` (DNAT by VIP ${vip.name} to ${vip.mappedIp})` : ''}: `;
  if (pm.policy) return { policyId: pm.policy.id, message: pre + `matches policy ${pm.policy.id} "${pm.policy.name}" (${pm.policy.action.toUpperCase()})`, trace: pm.trace };
  if (pm.intrazone) return { message: pre + 'allowed as intra-zone traffic', trace: pm.trace };
  return { policyId: '0', message: pre + 'no policy matches, so the Implicit Deny applies', trace: pm.trace };
}

// ---------- FortiGate-originated traffic (execute ping / traceroute) ----------

export interface LocalOutResult {
  rt: Runtime;
  result: SimResult;
  ok: boolean;
  dst?: string;
  error?: string;
  hops: string[];
  via?: string;
}

interface LocalOutcome extends Outcome {
  dst?: string;
  error?: string;
  hops: string[];
  via?: string;
}

function localOut(ctx: Ctx, dstIn: string, proto: Proto, dport: number): LocalOutcome {
  const { c, net } = ctx;
  let dst = dstIn.trim();
  if (!isIp(dst)) {
    const dns = gobj(c, 'system dns', 'primary');
    step(ctx, 'dns', 'info', `FortiGate resolves ${dst}`, `The FortiGate asks its system DNS server ${dns} (Network > DNS).`);
    const saved = ctx.prefix;
    ctx.prefix = '[DNS] ';
    const sub = localOut(ctx, dns, 'udp', 53);
    ctx.prefix = saved;
    const ip = sub.ok ? resolveName(dst) : null;
    if (!ip) {
      step(ctx, 'dns', 'fail', 'Name resolution failed', sub.ok ? `${dst} does not exist.` : `The DNS server could not be reached: ${sub.summary}`);
      return { ok: false, summary: 'Unable to resolve hostname.', error: 'Unable to resolve hostname.', hops: [] };
    }
    step(ctx, 'dns', 'ok', `DNS answer: ${dst} → ${ip}`, '');
    dst = ip;
  }
  const dstN = ipToInt(dst)!;
  ctx.traceId = ++ctx.rt.seq.trace;
  const own = net.ifList.find((i) => i.ip === dstN && i.up && !i.memberOf);
  if (own) {
    step(ctx, 'local', 'ok', 'Destination is the FortiGate itself', `${dst} is the address of ${own.name}.`);
    return { ok: true, summary: `${dst} is local`, dst, hops: [dst] };
  }
  const r = lookupRoute(net, dstN);
  if (!r || r.blackhole) {
    step(ctx, 'route', 'fail', `No route to ${dst}`, 'Even traffic generated by the FortiGate needs a route.', { hint: 'Check the routing table (get router info routing-table all).' });
    return { ok: false, summary: `No route to ${dst}`, error: 'connect: Network is unreachable', dst, hops: [] };
  }
  const src = net.ifs[r.device]?.ipStr || '0.0.0.0';
  const tup: Tuple = { proto, src, sport: proto === 'icmp' ? rnd(1000, 9999) : rnd(33000, 34000), dst, dport };
  D(ctx, 'print_pkt_detail', 5895, `vd-root:0 received a packet(proto=${PNUM[proto]}, ${tupleStr(tup)}) tun_id=0.0.0.0 from local.${proto === 'icmp' ? ` type=8, code=0, id=${tup.sport}, seq=0.` : ''}`);
  const sid = ++ctx.rt.seq.session;
  D(ctx, 'init_ip_session_common', 6076, `allocate a new session-${hex8(sid)}, tun_id=0.0.0.0`);
  D(ctx, 'vf_ip_route_input_common', 2605, `find a route: flag=00000000 gw-${r.gateway ?? dst} via ${r.device}`);
  step(ctx, 'local', 'ok', 'Local-out: the FortiGate sends the packet itself', `Source ${src} (address of ${r.device}). Traffic generated by the FortiGate is not checked against firewall policies.`);
  step(ctx, 'route', 'ok', `Route lookup: out via ${r.device}`, describeRoute(r) + '.');
  ev(ctx, r.device, 'out', tup, 'req');

  const nhN = ipToInt(r.gateway ?? dst)!;
  let target: Target;
  let hops: string[];
  if (ISPS[r.device] && nhN === ispIpN(r.device)) {
    const isp = ISPS[r.device];
    if (dstN === ispIpN(r.device)) {
      target = ispTarget(r.device);
      hops = [isp.ip];
    } else if (ispDown(r.device)) {
      step(ctx, 'delivery', 'fail', `${isp.name} outage`, `${isp.name}'s upstream is down.`);
      return { ok: false, summary: 'No reply', dst, hops: [isp.ip], via: r.device };
    } else if (isPrivate(dstN)) {
      step(ctx, 'delivery', 'fail', 'ISP drops the packet', `${dst} is private and not routable on the internet.`);
      return { ok: false, summary: 'No reply', dst, hops: [isp.ip], via: r.device };
    } else {
      target = targetFor(net, dstN);
      hops = [isp.ip, r.device === 'wan2' ? '198.18.99.1' : '100.64.10.1', r.device === 'wan2' ? '198.18.99.9' : '100.64.20.1', dst];
    }
  } else {
    const h = net.hosts.find((x) => x.ok && x.ipN === nhN && x.logical === r.device);
    if (!h || h.ipN !== dstN) {
      step(ctx, 'egress', 'fail', `No ARP reply for ${r.gateway ?? dst} on ${r.device}`, 'No device with that address answered.');
      return { ok: false, summary: 'No reply', dst, hops: [] };
    }
    target = hostTarget(h);
    hops = [dst];
  }
  // Traceroute probes (UDP 33434+) are answered with ICMP port unreachable by the final host.
  const resp = dport >= 33434 ? 'ok' : respond(target, proto, dport);
  if (resp !== 'ok') {
    step(ctx, 'delivery', 'fail', `${target.name} does not answer`, proto === 'icmp' ? 'The host ignores ping.' : `Port ${dport} is closed.`);
    return { ok: false, summary: `${target.name} did not answer`, dst, hops: hops.slice(0, -1) };
  }
  ctx.traceId = ++ctx.rt.seq.trace;
  const reply: Tuple = { proto, src: dst, sport: dport, dst: src, dport: tup.sport };
  pktLine(ctx, reply, r.device, true);
  ev(ctx, r.device, 'in', reply, 'rep');
  D(ctx, 'resolve_ip_tuple_fast', 5976, `Find an existing session, id-${hex8(sid)}, reply direction`);
  step(ctx, 'reply', 'ok', `${target.name} replies`, 'The reply matches the session and is delivered to the FortiGate itself.');
  return { ok: true, summary: `${target.name} (${dst}) answered`, dst, hops, via: r.device };
}

export function runLocalOut(c: Config, rt0: Runtime, target: string, kind: 'ping' | 'traceroute'): LocalOutResult {
  const rt: Runtime = { ...rt0, sessions: [...rt0.sessions], policyStats: { ...rt0.policyStats }, ifStats: { ...rt0.ifStats }, seq: { ...rt0.seq } };
  const ctx: Ctx = { c, net: buildNet(c), rt, now: Date.now(), steps: [], dbg: [], traceId: 0, prefix: '', pk: [], t: 0 };
  const out = kind === 'ping' ? localOut(ctx, target, 'icmp', 0) : localOut(ctx, target, 'udp', 33434);
  const result: SimResult = { id: ++rt.seq.result, time: ctx.now, label: `FortiGate: execute ${kind} ${target}`, ok: out.ok, summary: out.summary, steps: ctx.steps, debug: ctx.dbg, packets: ctx.pk };
  rt.history = [result, ...rt0.history].slice(0, 40);
  return { rt, result, ok: out.ok, dst: out.dst, error: out.error, hops: out.hops, via: out.via };
}

function fmtNet(s: string) {
  const n = parseIpMask(s);
  return n ? `${intToIp(n.ip)}/${n.prefix}` : s;
}
