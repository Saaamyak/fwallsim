// Typed read-only views over the config tree.
import type { Config, ConfigEntry } from './types';
import { def, entries, list, str } from './config';

export interface PolicyView {
  id: string;
  name: string;
  uuid: string;
  srcintf: string[];
  dstintf: string[];
  srcaddr: string[];
  dstaddr: string[];
  srcaddrNegate: boolean;
  dstaddrNegate: boolean;
  service: string[];
  serviceNegate: boolean;
  schedule: string;
  action: string;
  nat: boolean;
  ippool: boolean;
  poolname: string[];
  fixedport: boolean;
  status: boolean;
  logtraffic: string;
  logStart: boolean;
  comments: string;
  inspectionMode: string;
  sslProfile: string;
  groups: string[];
  users: string[];
}

export function policyView(e: ConfigEntry): PolicyView {
  const P = def('firewall policy');
  const s = (n: string) => str(P, e.f, n);
  const l = (n: string) => list(P, e.f, n);
  return {
    id: e.key,
    name: s('name'),
    uuid: s('uuid'),
    srcintf: l('srcintf'),
    dstintf: l('dstintf'),
    srcaddr: l('srcaddr'),
    dstaddr: l('dstaddr'),
    srcaddrNegate: s('srcaddr-negate') === 'enable',
    dstaddrNegate: s('dstaddr-negate') === 'enable',
    service: l('service'),
    serviceNegate: s('service-negate') === 'enable',
    schedule: s('schedule'),
    action: s('action'),
    nat: s('nat') === 'enable',
    ippool: s('ippool') === 'enable',
    poolname: l('poolname'),
    fixedport: s('fixedport') === 'enable',
    status: s('status') === 'enable',
    logtraffic: s('logtraffic'),
    logStart: s('logtraffic-start') === 'enable',
    comments: s('comments'),
    inspectionMode: s('inspection-mode'),
    sslProfile: s('ssl-ssh-profile'),
    groups: l('groups'),
    users: l('users'),
  };
}

export const policies = (c: Config) => entries(c, 'firewall policy').map(policyView);

export interface VipView {
  name: string;
  comment: string;
  extintf: string;
  extip: string;
  mappedip: string;
  arpReply: boolean;
  portforward: boolean;
  protocol: string;
  extport: string;
  mappedport: string;
}

export function vips(c: Config): VipView[] {
  const V = def('firewall vip');
  return entries(c, 'firewall vip').map((e) => ({
    name: e.key,
    comment: str(V, e.f, 'comment'),
    extintf: str(V, e.f, 'extintf'),
    extip: list(V, e.f, 'extip')[0] ?? '',
    mappedip: list(V, e.f, 'mappedip')[0] ?? '',
    arpReply: str(V, e.f, 'arp-reply') === 'enable',
    portforward: str(V, e.f, 'portforward') === 'enable',
    protocol: str(V, e.f, 'protocol'),
    extport: list(V, e.f, 'extport')[0] ?? '',
    mappedport: list(V, e.f, 'mappedport')[0] ?? '',
  }));
}

export interface PoolView {
  name: string;
  type: string;
  startip: string;
  endip: string;
  sourceStart: string;
  sourceEnd: string;
  arpReply: boolean;
  comments: string;
}

export function ippools(c: Config): PoolView[] {
  const P = def('firewall ippool');
  return entries(c, 'firewall ippool').map((e) => ({
    name: e.key,
    type: str(P, e.f, 'type'),
    startip: str(P, e.f, 'startip'),
    endip: str(P, e.f, 'endip'),
    sourceStart: str(P, e.f, 'source-startip'),
    sourceEnd: str(P, e.f, 'source-endip'),
    arpReply: str(P, e.f, 'arp-reply') === 'enable',
    comments: str(P, e.f, 'comments'),
  }));
}

export function vipDesc(v: VipView): string {
  const base = `${v.extip} → ${v.mappedip}`;
  return v.portforward ? `${base} (${v.protocol.toUpperCase()}: ${v.extport} → ${v.mappedport || v.extport})` : base;
}
