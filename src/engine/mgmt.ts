// Management-plane features: remote syslog, SNMP and firmware upgrades.
import type { Config } from './types';
import { def, entries, gobj, list, str, sub } from './config';
import { inNet, ipToInt, parseIpMask } from './ip';
import { lookupRoute, type Net } from './net';
import { MODEL } from './serialize';

export const NMS_IP = '10.10.10.30';

export interface SyslogTarget {
  ok: boolean;
  reason: string;
  server?: string;
  via?: string;
}

/** Can the FortiGate deliver syslog to the configured server? */
export function syslogTarget(c: Config, net: Net): SyslogTarget {
  if (gobj(c, 'log syslogd setting', 'status') !== 'enable') return { ok: false, reason: 'Remote syslog is disabled.' };
  const server = gobj(c, 'log syslogd setting', 'server');
  const n = ipToInt(server);
  if (n === null || n === 0) return { ok: false, reason: `Server "${server || '(empty)'}" is not a valid IP address.` };
  const r = lookupRoute(net, n);
  if (!r) return { ok: false, reason: `No route to syslog server ${server}.`, server };
  const port = Number(gobj(c, 'log syslogd setting', 'port'));
  const mode = gobj(c, 'log syslogd setting', 'mode');
  const h = net.hosts.find((x) => x.ok && x.ipN === n && x.logical === r.device);
  if (!h) return { ok: false, reason: `Nothing answers at ${server} on ${r.device}: logs are sent but lost.`, server, via: r.device };
  const proto = mode === 'udp' ? 'udp' : 'tcp';
  if (!h.host.listen.some((l) => l.proto === proto && l.port === port)) return { ok: false, reason: `${h.host.name} does not listen on ${proto.toUpperCase()}/${port} (it accepts syslog on UDP/514).`, server, via: r.device };
  return { ok: true, reason: `Delivering to ${h.host.name} (${server}) via ${r.device}`, server, via: r.device };
}

export interface SnmpResult {
  ok: boolean;
  reason: string;
  lines: string[];
}

/** What "snmpwalk -v2c -c <community> <fgt-ip>" on the NMS-Server returns, assuming the packet reached the FortiGate. */
export function snmpWalk(c: Config, net: Net, community: string, srcIp: string): SnmpResult {
  if (gobj(c, 'system snmp sysinfo', 'status') !== 'enable') return { ok: false, reason: 'Timeout: SNMP agent is disabled (System > SNMP > SNMP Agent).', lines: [] };
  const C = def('system snmp community');
  const H = C.fields.find((x) => x.name === 'hosts')!.sub!;
  const srcN = ipToInt(srcIp) ?? 0;
  const com = entries(c, 'system snmp community').find((e) => str(C, e.f, 'name') === community && str(C, e.f, 'status') === 'enable');
  if (!com) return { ok: false, reason: `Timeout: no enabled community named "${community}" (wrong community strings are silently ignored).`, lines: [] };
  if (str(C, com.f, 'query-v2c-status') !== 'enable') return { ok: false, reason: 'Timeout: SNMP v2c queries are disabled for this community.', lines: [] };
  const hosts = (sub(com.f, 'hosts')?.entries ?? []).map((h) => parseIpMask(str(H, h.f, 'ip'))).filter((x): x is NonNullable<typeof x> => !!x);
  if (hosts.length && !hosts.some((h) => inNet(srcN, h.ip, h.prefix))) return { ok: false, reason: `Timeout: ${srcIp} is not a host allowed by community "${community}".`, lines: [] };
  const g = (n: string) => gobj(c, 'system snmp sysinfo', n);
  const ifs = net.ifList.filter((i) => !i.memberOf);
  return {
    ok: true,
    reason: 'OK',
    lines: [
      `SNMPv2-MIB::sysDescr.0 = STRING: ${g('description') || MODEL}`,
      `SNMPv2-MIB::sysObjectID.0 = OID: FORTINET-FORTIGATE-MIB::fgt60F`,
      `SNMPv2-MIB::sysContact.0 = STRING: ${g('contact-info')}`,
      `SNMPv2-MIB::sysName.0 = STRING: ${gobj(c, 'system global', 'hostname')}`,
      `SNMPv2-MIB::sysLocation.0 = STRING: ${g('location')}`,
      `IF-MIB::ifNumber.0 = INTEGER: ${ifs.length}`,
      ...ifs.map((i, k) => `IF-MIB::ifDescr.${k + 1} = STRING: ${i.name}`),
      ...ifs.map((i, k) => `IF-MIB::ifOperStatus.${k + 1} = INTEGER: ${i.up ? 'up(1)' : 'down(2)'}`),
      `FORTINET-FORTIGATE-MIB::fgSysCpuUsage.0 = Gauge32: 3`,
      `FORTINET-FORTIGATE-MIB::fgSysMemUsage.0 = Gauge32: 41`,
    ],
  };
}

/** Does an enabled community allow this source IP (used for local-in SNMP packets from the Traffic Generator)? */
export function snmpAllows(c: Config, srcN: number): boolean {
  if (gobj(c, 'system snmp sysinfo', 'status') !== 'enable') return false;
  const C = def('system snmp community');
  const H = C.fields.find((x) => x.name === 'hosts')!.sub!;
  return entries(c, 'system snmp community').some((e) => {
    if (str(C, e.f, 'status') !== 'enable') return false;
    const hosts = (sub(e.f, 'hosts')?.entries ?? []).map((h) => parseIpMask(str(H, h.f, 'ip'))).filter((x): x is NonNullable<typeof x> => !!x);
    return !hosts.length || hosts.some((h) => inNet(srcN, h.ip, h.prefix));
  });
}

// ---------- firmware ----------

export interface Firmware {
  version: string; // "7.4.4"
  build: string;
  label: string;
  minFrom?: string; // must be at least this version to upgrade directly
}

export const FIRMWARES: Firmware[] = [
  { version: '7.4.4', build: '2662', label: 'Mature' },
  { version: '7.4.5', build: '2702', label: 'Mature' },
  { version: '7.4.6', build: '2726', label: 'Mature' },
  { version: '7.6.0', build: '3401', label: 'Feature', minFrom: '7.4.5' },
];

const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Null if a direct upgrade from -> to is supported, else the reason (as the Upgrade Path tool would say). */
export function upgradeBlocked(from: string, to: string): string | null {
  const t = FIRMWARES.find((f) => f.version === to);
  if (!t) return 'Unknown firmware version.';
  if (cmp(to, from) === 0) return 'This version is already running.';
  if (cmp(to, from) < 0) return `Downgrading from ${from} to ${to} is not supported in the lab (a real downgrade may lose configuration).`;
  if (t.minFrom && cmp(from, t.minFrom) < 0) return `Follow the upgrade path: upgrade to ${t.minFrom} first, then to ${to}.`;
  return null;
}

export { list };
