// Text output of "get", "diagnose" and "execute" commands, formatted like FortiOS.
import type { Config } from '../engine/types';
import { gobj } from '../engine/config';
import { buildNet, lookupRoute, routeCode, type Net, type RouteState } from '../engine/net';
import { inNet, intToIp, ipToInt, parseIpMask, prefixToMask } from '../engine/ip';
import { FW_BUILD, FW_VERSION, MODEL } from '../engine/serialize';
import { hex8, type PacketEvent, type Runtime, type Session } from '../engine/runtime';
import { PNUM, type Proto } from '../engine/objects';

const pad = (s: string | number, n: number) => String(s).padEnd(n);

export function macOf(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const b = [0x00, 0x09, 0x0f, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
  return b.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

export function systemStatus(c: Config, rt: Runtime): string {
  const d = new Date();
  const up = Math.floor((Date.now() - rt.bootTime) / 1000);
  return [
    `Version: ${MODEL} v${rt.firmware?.version ?? FW_VERSION.slice(1)},build${rt.firmware?.build ?? FW_BUILD},240514 (GA.M)`,
    'First GA patch build date: 230509',
    'Security Level: 2',
    'Firmware Signature: certified',
    'Virus-DB: 92.07950(2026-10-21 08:24)',
    'Extended DB: 92.07950(2026-10-21 08:23)',
    'AV AI/ML Model: 2.17914(2026-10-21 12:58)',
    'IPS-DB: 28.00921(2026-10-20 23:41)',
    'IPS-ETDB: 0.00000(2001-01-01 00:00)',
    'APP-DB: 28.00921(2026-10-20 23:41)',
    'Proxy-IPS-DB: 28.00921(2026-10-20 23:41)',
    'Proxy-IPS-ETDB: 0.00000(2001-01-01 00:00)',
    'Proxy-APP-DB: 28.00921(2026-10-20 23:41)',
    'FMWP-DB: 24.00079(2026-10-14 15:02)',
    'IPS Malicious URL Database: 5.00511(2026-10-21 10:15)',
    'IoT-Detect: 28.00921(2026-10-20 23:40)',
    'OT-Detect-DB: 0.00000(2001-01-01 00:00)',
    'OT-Patch-DB: 0.00000(2001-01-01 00:00)',
    'OT-Threat-DB: 6.00000(2026-10-03 16:07)',
    'IPS-Engine: 7.00532(2026-09-18 01:21)',
    `Serial-Number: ${MODEL}TK26000001`,
    'BIOS version: 05000013',
    'System Part-Number: P24305-03',
    'Log hard disk: Not available',
    `Hostname: ${gobj(c, 'system global', 'hostname')}`,
    'Private Encryption: Disable',
    `Operation Mode: ${gobj(c, 'system settings', 'opmode') === 'nat' ? 'NAT' : 'Transparent'}`,
    'Current virtual domain: root',
    'Max number of virtual domains: 10',
    'Virtual domains status: 1 in NAT mode, 0 in TP mode',
    'Virtual domain configuration: disable',
    'FIPS-CC mode: disable',
    'Current HA mode: standalone',
    `Branch point: ${FW_BUILD}`,
    'Release Version Information: GA',
    `System time: ${d.toDateString()} ${d.toTimeString().slice(0, 8)} ${d.getFullYear()}`.replace(` ${d.getFullYear()} `, ' '),
    `Last reboot reason: warm reboot`,
    `Uptime: ${Math.floor(up / 86400)} days, ${Math.floor((up % 86400) / 3600)} hours, ${Math.floor((up % 3600) / 60)} minutes`,
  ].join('\n');
}

export function perfStatus(rt: Runtime): string {
  const recent = rt.history.filter((h) => Date.now() - h.time < 60000).length;
  const cpu = Math.min(90, 1 + recent * 2);
  const up = Math.floor((Date.now() - rt.bootTime) / 1000);
  return [
    `CPU states: ${cpu}% user 0% system 0% nice ${100 - cpu}% idle 0% iowait 0% irq 0% softirq`,
    `CPU0 states: ${cpu}% user 0% system 0% nice ${100 - cpu}% idle 0% iowait 0% irq 0% softirq`,
    `CPU1 states: 0% user 0% system 0% nice 100% idle 0% iowait 0% irq 0% softirq`,
    `Memory: 2005616k total, 822432k used (41.0%), 1009180k free (50.3%), 174004k freeable (8.7%)`,
    `Average network usage: ${recent * 12} / ${recent * 9} kbps in 1 minute, ${recent * 3} / ${recent * 2} kbps in 10 minutes, 0 / 0 kbps in 30 minutes`,
    `Maximal network usage: ${recent * 40} / ${recent * 30} kbps in 1 minute, ${recent * 40} / ${recent * 30} kbps in 10 minutes, ${recent * 40} / ${recent * 30} kbps in 30 minutes`,
    `Average sessions: ${rt.sessions.length} sessions in 1 minute, ${rt.sessions.length} sessions in 10 minutes, ${rt.sessions.length} sessions in 30 minutes`,
    `Maximal sessions: ${rt.sessions.length} sessions in 1 minute, ${rt.sessions.length} sessions in 10 minutes, ${rt.sessions.length} sessions in 30 minutes`,
    `Average session setup rate: 0 sessions per second in last 1 minute, 0 sessions per second in last 10 minutes, 0 sessions per second in last 30 minutes`,
    `Maximal session setup rate: ${recent} sessions per second in last 1 minute, ${recent} sessions per second in last 10 minutes, ${recent} sessions per second in last 30 minutes`,
    `Average NPU sessions: 0 sessions in last 1 minute, 0 sessions in last 10 minutes, 0 sessions in last 30 minutes`,
    `Virus caught: 0 total in 1 minute`,
    `IPS attacks blocked: 0 total in 1 minute`,
    `Uptime: ${Math.floor(up / 86400)} days,  ${Math.floor((up % 86400) / 3600)} hours,  ${Math.floor((up % 3600) / 60)} minutes`,
  ].join('\n');
}

export function interfaceList(net: Net): string {
  return net.ifList
    .map((i) => {
      const ip = i.ipStr ? `${i.ipStr} ${prefixToMask(i.prefix)}` : '0.0.0.0 0.0.0.0';
      return `== [ ${i.name} ]\nname: ${i.name}   mode: ${i.mode}    ip: ${ip}   status: ${i.adminUp ? 'up' : 'down'}    netbios-forward: disable    type: ${i.type}   role: ${i.role}   ${i.memberOf ? `switch-member: ${i.memberOf}   ` : ''}mtu-override: disable    wccp: disable    drop-overlapped-fragment: disable    drop-fragment: disable`;
    })
    .join('\n');
}

export function interfacePhysical(net: Net): string {
  const out = ['== [onboard]'];
  for (const i of net.ifList.filter((x) => x.type === 'physical')) {
    out.push(
      `\t==[${i.name}]`,
      `\t\tmode: ${i.mode}`,
      `\t\tip: ${i.ipStr ? `${i.ipStr} ${prefixToMask(i.prefix)}` : '0.0.0.0 0.0.0.0'}`,
      `\t\tipv6: ::/0`,
      `\t\tstatus: ${i.link && i.adminUp ? 'up' : 'down'}`,
      `\t\tspeed: ${i.link && i.adminUp ? '1000Mbps (Duplex: full)' : 'n/a'}`,
      `\t\tFEC: none`,
      `\t\tFEC_cap: none`,
    );
  }
  return out.join('\n');
}

interface Neighbor {
  ip: string;
  mac: string;
  intf: string;
}

function neighbors(net: Net): Neighbor[] {
  return net.hosts.filter((h) => h.ok && h.logical && h.ip && net.ifs[h.logical]?.up).map((h) => ({ ip: h.ip!, mac: macOf(h.host.id), intf: h.logical! }));
}

export function arpTable(net: Net): string {
  const rows = neighbors(net).map((n) => `${pad(n.ip, 18)}${pad(0, 11)}${pad(n.mac, 19)}${n.intf}`);
  return [`${pad('Address', 18)}${pad('Age(min)', 11)}${pad('Hardware Addr', 19)}Interface`, ...rows].join('\n');
}

export function arpList(net: Net): string {
  return neighbors(net)
    .map((n, i) => `index=${5 + i} ifname=${n.intf} ${n.ip} ${n.mac} state=00000002 use=${120 + i * 7} confirm=${120 + i * 7} update=${1500 + i} ref=2`)
    .join('\n');
}

function routeLine(r: RouteState): string {
  const dst = `${intToIp(r.net)}/${r.prefix}`;
  const code = routeCode(r).padEnd(8);
  if (r.type === 'connected') return `${code}${dst} is directly connected, ${r.device}`;
  if (r.blackhole) return `${code}${dst} [${r.distance}/0] is a summary, Null, [${r.priority}/0]`;
  if (!r.gateway) return `${code}${dst} [${r.distance}/0] is directly connected, ${r.device}, [${r.priority}/0]`;
  if (r.type === 'bgp') return `${code}${dst} [${r.distance}/0] via ${r.gateway} (recursive is directly connected, ${r.device}), 00:05:12, [${r.priority}/0]`;
  if (r.type === 'ospf') return `${code}${dst} [${r.distance}/${r.metric ?? 1}] via ${r.gateway}, ${r.device}, 00:01:10, [${r.priority}/0]`;
  return `${code}${dst} [${r.distance}/0] via ${r.gateway}, ${r.device}, [${r.priority}/0]`;
}

const RT_HEAD = `Codes: K - kernel, C - connected, S - static, R - RIP, B - BGP
       O - OSPF, IA - OSPF inter area
       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2
       E1 - OSPF external type 1, E2 - OSPF external type 2
       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area
       V - BGP VPNv4
       * - candidate default
`;

export function routingTable(net: Net, mode: 'all' | 'database'): string {
  const sorted = [...net.routes].sort((a, b) => a.net - b.net || a.prefix - b.prefix || a.distance - b.distance);
  if (mode === 'all') return [RT_HEAD, 'Routing table for VRF=0', ...sorted.filter((r) => r.active).map(routeLine)].join('\n');
  return [
    RT_HEAD.replace('* - candidate default', '* - candidate default\n       > - selected route, * - FIB route, p - stale info'),
    'Routing table for VRF=0',
    ...sorted.map((r) => {
      const line = routeLine(r);
      return r.active ? line.replace(/^(\S+)\s+/, (_, c) => `${c} *> `.padEnd(8)) : `${line}   (inactive: ${r.reason ?? 'not selected'})`;
    }),
  ].join('\n');
}

export function routeDetails(net: Net, ip?: string): string {
  if (!ip) return routingTable(net, 'all');
  const n = ipToInt(ip);
  if (n === null) return `Invalid IP address: ${ip}`;
  const r = lookupRoute(net, n);
  if (!r) return `Routing table for VRF=0\n% Network not in table`;
  return [
    'Routing table for VRF=0',
    `Routing entry for ${intToIp(r.net)}/${r.prefix}`,
    `  Known via "${r.type === 'connected' ? 'connected' : 'static'}", distance ${r.distance}, metric 0, best`,
    r.type === 'connected' ? `  * directly connected, ${r.device}` : `  * vrf 0 ${r.gateway}, via ${r.device}`,
  ].join('\n');
}

export function sessionListDiag(sessions: Session[]): string {
  if (!sessions.length) return 'total session 0';
  const out = sessions.map((s) => {
    const p = PNUM[s.proto];
    const age = Math.round((Date.now() - s.created) / 1000);
    const nat = s.natSrc ? `hook=post dir=org act=snat ${s.src}:${s.sport}->${s.dst}:${s.dport}(${s.natSrc}:${s.natSport})\nhook=pre dir=reply act=dnat ${s.dst}:${s.dport}->${s.natSrc}:${s.natSport}(${s.src}:${s.sport})` : '';
    const dnat = s.dnatDst ? `hook=pre dir=org act=dnat ${s.src}:${s.sport}->${s.dst}:${s.dport}(${s.dnatDst}:${s.dnatPort})\nhook=post dir=reply act=snat ${s.dnatDst}:${s.dnatPort}->${s.src}:${s.sport}(${s.dst}:${s.dport})` : '';
    return [
      `session info: proto=${p} proto_state=${s.proto === 'tcp' ? (s.state === 'established' ? '01' : s.state === 'syn_sent' ? '02' : '05') : '00'} duration=${age} expire=${Math.max(0, s.ttl - age)} timeout=${s.ttl} flags=00000000 socktype=0 sockport=0 av_idx=0 use=3`,
      `origin-shaper=`,
      `reply-shaper=`,
      `per_ip_shaper=`,
      `class_id=0 ha_id=0 policy_dir=0 tunnel=/ vlan_cos=0/255`,
      `state=log may_dirty`,
      `statistic(bytes/packets/allow_err): org=${s.sentbyte}/${Math.max(1, Math.ceil(s.sentbyte / 900))}/1 reply=${s.rcvdbyte}/${s.rcvdbyte ? Math.max(1, Math.ceil(s.rcvdbyte / 1400)) : 0}/1 tuples=2`,
      `tx speed(Bps/kbps): 0/0 rx speed(Bps/kbps): 0/0`,
      `orgin->sink: org pre->post, reply pre->post dev=${s.srcintf}->${s.dstintf}/${s.dstintf}->${s.srcintf} gwy=0.0.0.0/0.0.0.0`,
      nat || dnat || `hook=pre dir=org act=noop ${s.src}:${s.sport}->${s.dst}:${s.dport}(0.0.0.0:0)\nhook=post dir=reply act=noop ${s.dst}:${s.dport}->${s.src}:${s.sport}(0.0.0.0:0)`,
      `pos/(before,after) 0/(0,0), 0/(0,0)`,
      `misc=0 policy_id=${s.policyid} pol_uuid_idx=0 auth_info=0 chk_client_info=0 vd=0`,
      `serial=${hex8(s.id)} tos=ff/ff app_list=0 app=0 url_cat=0`,
      `rpdb_link_id=00000000 ngfwid=n/a`,
      `npu_state=0x000100`,
      `no_ofld_reason:  non-npu-intf`,
    ].join('\n');
  });
  return out.join('\n\n') + `\ntotal session ${sessions.length}`;
}

export function sessionListGet(sessions: Session[]): string {
  const head = `${pad('PROTO', 6)}${pad('EXPIRE', 7)}${pad('SOURCE', 22)}${pad('SOURCE-NAT', 22)}${pad('DESTINATION', 22)}DESTINATION-NAT`;
  const rows = sessions.map((s) => {
    const left = Math.max(0, s.ttl - Math.round((Date.now() - s.created) / 1000));
    return `${pad(s.proto, 6)}${pad(left, 7)}${pad(`${s.src}:${s.sport}`, 22)}${pad(s.natSrc ? `${s.natSrc}:${s.natSport}` : '-', 22)}${pad(`${s.dst}:${s.dport}`, 22)}${s.dnatDst ? `${s.dnatDst}:${s.dnatPort}` : '-'}`;
  });
  return [head, ...rows].join('\n');
}

export function dhcpLeases(net: Net): string {
  const by: Record<string, string[]> = {};
  for (const h of net.hosts.filter((x) => x.dhcp && x.ok)) {
    const exp = new Date(Date.now() + 6 * 86400000);
    (by[h.logical!] ??= []).push(`  ${pad(h.ip!, 23)}${pad(macOf(h.host.id), 21)}${pad(h.host.name, 18)}${exp.toDateString()} ${exp.toTimeString().slice(0, 8)}`);
  }
  const blocks = Object.entries(by).map(([intf, rows]) => [intf, `  ${pad('IP', 23)}${pad('MAC-Address', 21)}${pad('Hostname', 18)}Expiry`, ...rows].join('\n'));
  return blocks.length ? blocks.join('\n\n') : '';
}

export function nicInfo(c: Config, net: Net, name: string): string {
  const i = net.ifs[name];
  if (!i) return `${name}: no such device`;
  const up = i.link && i.adminUp;
  return [
    `Description     :FortiASIC NP6XLITE Adapter`,
    `Driver Name     :FortiASIC NP6XLITE Driver`,
    `Name            :${name}`,
    `Board           :${MODEL}`,
    `SN              :${MODEL}TK26000001`,
    `Current_HWaddr   ${macOf(name)}`,
    `Permanent_HWaddr ${macOf(name)}`,
    `========== Link Status ==========`,
    `Admin           :${i.adminUp ? 'up' : 'down'}`,
    `netdev status   :${up ? 'up' : 'down'}`,
    `autonego_setting:1`,
    `link_setting    :1`,
    `speed_setting   :1000`,
    `duplex_setting  :0`,
    `Speed           :${up ? '1000' : 'n/a'}`,
    `Duplex          :${up ? 'Full' : 'n/a'}`,
    `link_status     :${up ? 'Up' : 'Down'}`,
    i.memberOf ? `Member of       :${i.memberOf} (hardware switch)` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const haStatus = (c: Config) =>
  [`HA Health Status: OK`, `Model: ${MODEL}`, `Mode: standalone`, `Group: 0`, `Debug: 0`, `Cluster Uptime: n/a`, `Hostname: ${gobj(c, 'system global', 'hostname')}`, `(HA is planned for v1.1)`].join('\n');

// ---------- packet sniffer ----------

export type Pred = (e: PacketEvent) => boolean;

/** Small tcpdump/BPF subset: host, net, port (with src/dst), tcp/udp/icmp, and/or/not, parentheses. */
export function compileFilter(expr: string): Pred | string {
  const t = expr
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .replace(/&&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .replace(/!/g, ' not ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!t.length || (t.length === 1 && t[0] === 'none')) return () => true;
  let i = 0;
  const peek = () => t[i];
  const eat = () => t[i++];
  const primary = (): Pred | string => {
    const w = eat();
    if (w === undefined) return 'unexpected end of filter';
    if (w === '(') {
      const e = orExpr();
      if (typeof e === 'string') return e;
      if (eat() !== ')') return "missing ')'";
      return e;
    }
    if (w === 'not') {
      const e = primary();
      return typeof e === 'string' ? e : (x) => !e(x);
    }
    if (w === 'tcp' || w === 'udp' || w === 'icmp') return (x) => x.proto === (w as Proto);
    if (w === 'arp') return () => false;
    let dir: 'src' | 'dst' | null = null;
    let kw = w;
    if (w === 'src' || w === 'dst') {
      dir = w;
      kw = eat() ?? '';
    }
    const pick = (x: PacketEvent, a: 'ip' | 'port') => (a === 'ip' ? (dir === 'src' ? [x.src] : dir === 'dst' ? [x.dst] : [x.src, x.dst]) : dir === 'src' ? [x.sport] : dir === 'dst' ? [x.dport] : [x.sport, x.dport]);
    if (kw === 'host') {
      const v = eat();
      if (!v || ipToInt(v) === null) return `invalid host '${v ?? ''}'`;
      return (x) => (pick(x, 'ip') as string[]).includes(v);
    }
    if (kw === 'net') {
      const n = parseIpMask(eat() ?? '');
      if (!n) return 'invalid net';
      return (x) => (pick(x, 'ip') as string[]).some((ip) => inNet(ipToInt(ip)!, n.ip, n.prefix));
    }
    if (kw === 'port') {
      const v = Number(eat());
      if (!Number.isInteger(v)) return 'invalid port';
      return (x) => x.proto !== 'icmp' && (pick(x, 'port') as number[]).includes(v);
    }
    if (ipToInt(kw) !== null) return (x) => (pick(x, 'ip') as string[]).includes(kw);
    return `syntax error near '${kw}'`;
  };
  const orExpr = (): Pred | string => {
    let left = primary();
    while (typeof left !== 'string' && (peek() === 'and' || peek() === 'or')) {
      const op = eat();
      const right = primary();
      if (typeof right === 'string') return right;
      const l = left;
      left = op === 'and' ? (x) => l(x) && right(x) : (x) => l(x) || right(x);
    }
    return left;
  };
  const res = orExpr();
  if (typeof res !== 'string' && i < t.length) return `syntax error near '${t[i]}'`;
  return res;
}

function ipHex(e: PacketEvent): string[] {
  const ip = (s: string) => s.split('.').map((x) => Number(x).toString(16).padStart(2, '0'));
  const proto = PNUM[e.proto].toString(16).padStart(2, '0');
  const p16 = (n: number) => [(n >> 8) & 255, n & 255].map((x) => x.toString(16).padStart(2, '0'));
  const len = e.proto === 'tcp' ? 60 : e.proto === 'udp' ? 60 : 84;
  const bytes = ['45', '00', ...p16(len), ...p16((e.sport * 7) & 0xffff), '40', '00', e.dir === 'in' ? '3f' : '40', proto, 'b1', 'e6', ...ip(e.src), ...ip(e.dst), ...(e.proto === 'icmp' ? ['08', '00', '4d', '5a', ...p16(e.sport), '00', '01'] : [...p16(e.sport), ...p16(e.dport), '9a', '3c', '1f', '02'])];
  const out: string[] = [];
  for (let o = 0; o < bytes.length; o += 16) {
    const chunk = bytes.slice(o, o + 16);
    const words = [];
    for (let j = 0; j < chunk.length; j += 2) words.push(chunk.slice(j, j + 2).join(''));
    const ascii = chunk.map((b) => {
      const n = parseInt(b, 16);
      return n >= 32 && n < 127 ? String.fromCharCode(n) : '.';
    });
    out.push(`0x${o.toString(16).padStart(4, '0')}\t ${words.join(' ').padEnd(40)}\t${ascii.join('')}`);
  }
  return out;
}

export function snifferLine(e: PacketEvent, verbose: number, ts: string): string[] {
  const withIntf = verbose >= 4;
  const pre = `${ts} ${withIntf ? `${e.intf} ${e.dir} ` : ''}`;
  let body: string;
  if (e.flag === 'unreach') body = `${e.src} -> ${e.dst}: icmp: ${e.src} udp port ${e.sport} unreachable`;
  else if (e.proto === 'icmp') body = `${e.src} -> ${e.dst}: icmp: echo ${e.flag === 'req' ? 'request' : 'reply'}`;
  else if (e.proto === 'udp') body = `${e.src}.${e.sport} -> ${e.dst}.${e.dport}: udp ${e.dport === 53 || e.sport === 53 ? (e.flag === 'req' ? 32 : 48) : 24}`;
  else {
    const seq = ((e.sport * 2654435761) >>> 0) % 4000000000;
    body = `${e.src}.${e.sport} -> ${e.dst}.${e.dport}: ${e.flag === 'req' ? `syn ${seq}` : e.flag === 'rst' ? `rst ${seq} ack ${seq + 1}` : `syn ${seq} ack ${(seq + 1) >>> 0}`}`;
  }
  const lines = [pre + body];
  if (verbose === 2 || verbose === 3 || verbose === 5 || verbose === 6) lines.push(...ipHex(e), '');
  return lines;
}

// ---------- debug flow filter ----------

export interface FlowFilter {
  addr?: string;
  saddr?: string;
  daddr?: string;
  port?: number;
  sport?: number;
  dport?: number;
  proto?: number;
}

const PKT_RE = /received a packet\(proto=(\d+), ([\d.]+):(\d+)->([\d.]+):(\d+)\)/;

/** Split trace lines into per-packet groups (by trace_id) and keep the ones matching the filter. */
export function filterTrace(lines: string[], f: FlowFilter): string[][] {
  const groups: Record<string, string[]> = {};
  const order: string[] = [];
  for (const l of lines) {
    const id = /trace_id=(\d+)/.exec(l)?.[1] ?? '0';
    if (!groups[id]) {
      groups[id] = [];
      order.push(id);
    }
    groups[id].push(l);
  }
  return order
    .map((id) => groups[id])
    .filter((g) => {
      const m = PKT_RE.exec(g[0]);
      if (!m) return true;
      const [, proto, src, sp, dst, dp] = m;
      if (f.proto !== undefined && Number(proto) !== f.proto) return false;
      if (f.addr && src !== f.addr && dst !== f.addr) return false;
      if (f.saddr && src !== f.saddr) return false;
      if (f.daddr && dst !== f.daddr) return false;
      if (f.port !== undefined && Number(sp) !== f.port && Number(dp) !== f.port) return false;
      if (f.sport !== undefined && Number(sp) !== f.sport) return false;
      if (f.dport !== undefined && Number(dp) !== f.dport) return false;
      return true;
    });
}

export function flowFilterText(f: FlowFilter): string {
  const r = (v?: string) => (v ? `${v}-${v}` : 'any');
  const p = (v?: number) => (v !== undefined ? `${v}-${v}` : 'any');
  return [`vf: any`, `proto: ${f.proto ?? 'any'}`, `Host addr: ${r(f.addr)}`, `Host saddr: ${r(f.saddr)}`, `Host daddr: ${r(f.daddr)}`, `port: ${p(f.port)}`, `sport: ${p(f.sport)}`, `dport: ${p(f.dport)}`].join('\n');
}

export { buildNet };
