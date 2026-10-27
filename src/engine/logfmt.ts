// FortiOS key=value log format (Log Details "raw log", downloads, and remote syslog).
import type { EventLog, TrafficLog } from './runtime';

const p2 = (x: number) => String(x).padStart(2, '0');

function kvJoin(kv: [string, string | number | undefined, boolean?][]) {
  return kv
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v, q]) => `${k}=${q ? `"${v}"` : v}`)
    .join(' ');
}

function stamp(t: number): [string, string | number | undefined, boolean?][] {
  const d = new Date(t);
  return [
    ['date', `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`],
    ['time', `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`],
    ['eventtime', `${t}000000`],
  ];
}

export function trafficRaw(l: TrafficLog, dev?: { name: string; id: string }): string {
  return kvJoin([
    ...stamp(l.time),
    ...(dev ? ([['devname', dev.name, true], ['devid', dev.id, true]] as [string, string, boolean][]) : []),
    ['logid', l.subtype === 'forward' ? '0000000013' : '0001000014', true],
    ['type', 'traffic', true],
    ['subtype', l.subtype, true],
    ['level', l.level, true],
    ['vd', 'root', true],
    ['srcip', l.srcip],
    ['srcport', l.srcport],
    ['srcintf', l.srcintf, true],
    ['srcintfrole', l.srcintfrole, true],
    ['dstip', l.dstip],
    ['dstport', l.dstport],
    ['dstintf', l.dstintf, true],
    ['dstintfrole', l.dstintfrole, true],
    ['srccountry', l.srccountry, true],
    ['dstcountry', l.dstcountry, true],
    ['sessionid', l.sessionid],
    ['proto', l.proto],
    ['action', l.action, true],
    ['policyid', l.policyid],
    ['policytype', 'policy', true],
    ['poluuid', l.policyuuid || undefined, true],
    ['policyname', l.policyname || undefined, true],
    ['service', l.service, true],
    ['trandisp', l.trandisp, true],
    ['transip', l.transip],
    ['transport', l.transport],
    ['tranip', l.tranip],
    ['tranport', l.tranport],
    ['duration', l.duration],
    ['sentbyte', l.sentbyte],
    ['rcvdbyte', l.rcvdbyte],
    ['sentpkt', l.sentpkt],
    ['rcvdpkt', l.rcvdpkt],
    ['appcat', 'unscanned', true],
    ['msg', l.msg, true],
  ]);
}

export function eventRaw(e: EventLog, dev?: { name: string; id: string }): string {
  return kvJoin([
    ...stamp(e.time),
    ...(dev ? ([['devname', dev.name, true], ['devid', dev.id, true]] as [string, string, boolean][]) : []),
    ['logid', '0100032102', true],
    ['type', 'event', true],
    ['subtype', 'system', true],
    ['level', e.level, true],
    ['vd', 'root', true],
    ['logdesc', e.logdesc, true],
    ['user', e.user, true],
    ['ui', e.ui, true],
    ['action', e.action, true],
    ['msg', e.msg, true],
  ]);
}
