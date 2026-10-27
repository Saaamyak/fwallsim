// Live (non-config) state: sessions, logs, counters, simulation history.
import type { Proto } from './objects';
import { defaultLab, type LabState } from './lab';

export interface Session {
  id: number;
  proto: Proto;
  src: string;
  sport: number;
  dst: string;
  dport: number;
  srcintf: string;
  dstintf: string;
  policyid: number;
  state: string;
  created: number;
  ttl: number;
  natSrc?: string;
  natSport?: number;
  dnatDst?: string;
  dnatPort?: number;
  sentbyte: number;
  rcvdbyte: number;
  srcname: string;
}

export interface TrafficLog {
  id: number;
  time: number;
  subtype: 'forward' | 'local';
  action: string;
  level: string;
  srcip: string;
  srcport: number;
  srcintf: string;
  srcintfrole: string;
  srccountry: string;
  srcname: string;
  dstip: string;
  dstport: number;
  dstintf: string;
  dstintfrole: string;
  dstcountry: string;
  proto: number;
  service: string;
  policyid: number;
  policyname: string;
  policyuuid: string;
  sessionid: number;
  trandisp: string;
  transip?: string;
  transport?: number;
  tranip?: string;
  tranport?: number;
  duration: number;
  sentbyte: number;
  rcvdbyte: number;
  sentpkt: number;
  rcvdpkt: number;
  msg?: string;
}

export interface EventLog {
  id: number;
  time: number;
  level: string;
  user: string;
  ui: string;
  action: string;
  logdesc: string;
  msg: string;
}

export interface Step {
  stage: string;
  status: 'ok' | 'fail' | 'info' | 'skip';
  title: string;
  detail: string;
  hint?: string;
  lines?: string[];
}

/** One packet seen on a FortiGate interface (feeds "diagnose sniffer packet"). */
export interface PacketEvent {
  t: number; // ms offset inside the simulation
  intf: string;
  dir: 'in' | 'out';
  proto: Proto;
  src: string;
  sport: number;
  dst: string;
  dport: number;
  flag: 'req' | 'rep' | 'rst' | 'unreach';
}

export interface SimResult {
  id: number;
  time: number;
  label: string;
  ok: boolean;
  summary: string;
  steps: Step[];
  debug: string[];
  packets?: PacketEvent[];
}

export interface PolicyStats {
  hits: number;
  bytes: number;
  first?: number;
  last?: number;
}

export interface IfStats {
  rxB: number;
  txB: number;
  rxP: number;
  txP: number;
}

export interface Runtime {
  bootTime: number;
  sessions: Session[];
  trafficLogs: TrafficLog[];
  eventLogs: EventLog[];
  policyStats: Record<string, PolicyStats>;
  ifStats: Record<string, IfStats>;
  history: SimResult[];
  seq: { session: number; trace: number; log: number; result: number };
  lab: LabState;
  adminLock: Record<string, { fails: number; until: number }>; // per source IP
  syslog: string[]; // lines received by the lab syslog server (newest first)
  firmware: { version: string; build: string };
}

export function emptyRuntime(): Runtime {
  return {
    bootTime: Date.now(),
    sessions: [],
    trafficLogs: [],
    eventLogs: [],
    policyStats: {},
    ifStats: {},
    history: [],
    seq: { session: 0x2a00, trace: 0, log: 0, result: 0 },
    lab: defaultLab(),
    adminLock: {},
    syslog: [],
    firmware: { version: '7.4.4', build: '2662' },
  };
}

export const hex8 = (n: number) => n.toString(16).padStart(8, '0');
