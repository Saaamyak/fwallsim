// IPsec site-to-site to the simulated Branch-FGT, and SSL-VPN for the remote laptop.
import type { Config, Fields } from './types';
import { def, entries, find, list, str, sub, tableOf } from './config';
import { fmtCidr, inNet, ipToInt, parseIpMask, parseIpRange } from './ip';
import { lookupRoute, type Net } from './net';
import { getLab } from './lab';
import { authenticate } from './auth';
import { addrMatches } from './objects';

/** The remote side. Its settings are fixed: the learner must configure HQ to match. */
export const BRANCH = {
  name: 'Branch-FGT',
  publicIp: '198.51.100.200',
  lan: '10.20.0.0/24',
  pc: '10.20.0.10',
  p1: {
    ikeVersion: '2',
    peerIp: '203.0.113.10', // the branch only accepts HQ's wan1 address
    proposals: ['aes256-sha256', 'aes256gcm-prfsha384'],
    dhgrp: ['14'],
    psk: 'Branch-PSK-2026',
  },
  p2: { proposals: ['aes256-sha256', 'aes256gcm'], pfs: true, dhgrp: ['14'], local: '10.20.0.0/24', remote: '192.168.1.0/24' },
};

export const P1_DEFAULT_PROPOSALS = ['aes128-sha256', 'aes256-sha256', 'aes128gcm-prfsha256', 'aes256gcm-prfsha384', 'chacha20poly1305-prfsha256'];
export const P2_DEFAULT_PROPOSALS = ['aes128-sha1', 'aes256-sha1', 'aes128-sha256', 'aes256-sha256', 'aes128gcm', 'aes256gcm', 'chacha20poly1305'];
export const P1_PROPOSAL_CHOICES = ['des-md5', 'des-sha1', 'des-sha256', '3des-sha1', '3des-sha256', 'aes128-sha1', 'aes128-sha256', 'aes256-sha1', 'aes256-sha256', 'aes128gcm-prfsha256', 'aes256gcm-prfsha384', 'chacha20poly1305-prfsha256'];
export const P2_PROPOSAL_CHOICES = ['null-sha256', 'des-sha1', '3des-sha1', 'aes128-sha1', 'aes128-sha256', 'aes256-sha1', 'aes256-sha256', 'aes128gcm', 'aes256gcm', 'chacha20poly1305'];

export interface P2State {
  name: string;
  up: boolean;
  src: string; // effective selectors (after IKEv2 narrowing)
  dst: string;
  error?: string;
}

export interface TunnelState {
  name: string;
  up: boolean;
  p1Up: boolean;
  error?: string;
  localGw?: string;
  remoteGw: string;
  outIntf: string;
  ikeVersion: string;
  p2: P2State[];
  ike: string[];
}

const BRANCH_LAN = parseIpMask(BRANCH.lan)!;
const HQ_LAN = parseIpMask(BRANCH.p2.remote)!;

function sameNet(a: string, b: { ip: number; prefix: number }) {
  const n = parseIpMask(a);
  return !!n && n.prefix === b.prefix && inNet(n.ip, b.ip, b.prefix);
}
const isAny = (s: string) => {
  const n = parseIpMask(s);
  return !!n && n.prefix === 0;
};

function evalTunnel(c: Config, net: Net, name: string, f: Fields): TunnelState {
  const P1 = def('vpn ipsec phase1-interface');
  const P2 = def('vpn ipsec phase2-interface');
  const s = (n: string) => str(P1, f, n);
  const ver = s('ike-version');
  const intf = s('interface');
  const rgw = s('remote-gw');
  const ike: string[] = [];
  const seq = 10 + (name.length * 7) % 40;
  const L = (m: string) => ike.push(`ike 0:${name}: ${m}`);
  const N = (m: string) => ike.push(`ike 0:${name}:${seq}: ${m}`);
  const st: TunnelState = { name, up: false, p1Up: false, remoteGw: rgw, outIntf: intf, ikeVersion: ver, p2: [], ike };
  const p2s = entries(c, 'vpn ipsec phase2-interface').filter((e) => str(P2, e.f, 'phase1name') === name);
  const fail = (error: string, p2error = 'phase 1 is down'): TunnelState => {
    st.error = error;
    st.p2 = p2s.map((e) => ({ name: e.key, up: false, src: str(P2, e.f, 'src-subnet'), dst: str(P2, e.f, 'dst-subnet'), error: p2error }));
    return st;
  };

  if (getLab().vpnDown?.[name]) {
    L('connection brought down by administrator');
    return fail('Brought down manually (Bring Up to reconnect)');
  }
  const oif = net.ifs[intf];
  if (!oif || !oif.up || oif.ip === null) {
    L(`outgoing interface ${intf || '(none)'} is down or has no IP address`);
    return fail(`Outgoing interface ${intf || '(none)'} is down or has no IP address`);
  }
  const rgwN = ipToInt(rgw);
  if (rgwN === null || rgwN === 0) return fail('Remote gateway is not set');
  const r = lookupRoute(net, rgwN);
  if (!r) {
    L(`no route to remote gateway ${rgw}`);
    return fail(`No route to remote gateway ${rgw}`);
  }
  st.localGw = oif.ipStr;
  L('auto-negotiate connection');
  L(`created connection: 0x7f3a2c18 ${intf} ${oif.ipStr}->${rgw}:500.`);
  const timeout = (why: string) => {
    if (ver === '1') N('initiator: main mode is sending 1st message...');
    else N('initiator: sending SA_INIT request');
    N(`sent IKE msg (${ver === '1' ? 'ident_i1send' : 'SA_INIT'}): ${oif.ipStr}:500->${rgw}:500, len=${ver === '1' ? 556 : 532}`);
    N('could not send IKE Packet / no response, retransmitting...');
    N('negotiation timeout, deleting');
    return fail(why);
  };
  if (rgw !== BRANCH.publicIp) return timeout(`No response from ${rgw} (timeout). Nothing at that address speaks IKE. Is the remote gateway correct?`);
  if (oif.ipStr !== BRANCH.p1.peerIp) return timeout(`No response (timeout). The branch only accepts IKE from ${BRANCH.p1.peerIp}, but this tunnel uses ${oif.ipStr}.`);
  if (ver !== BRANCH.p1.ikeVersion) return timeout(`No response (timeout). The peer runs IKEv${BRANCH.p1.ikeVersion} and ignores IKEv${ver} packets: IKE version mismatch.`);

  const props = list(P1, f, 'proposal').length ? list(P1, f, 'proposal') : P1_DEFAULT_PROPOSALS;
  const dh = list(P1, f, 'dhgrp');
  N('initiator: sending SA_INIT request');
  N(`sent IKE msg (SA_INIT): ${oif.ipStr}:500->${rgw}:500, len=532`);
  const prop = props.find((p) => BRANCH.p1.proposals.includes(p));
  const grp = dh.find((g) => BRANCH.p1.dhgrp.includes(g));
  if (!prop || !grp) {
    N(`received IKE msg (SA_INIT): ${rgw}:500->${oif.ipStr}:500, len=36`);
    N('received notify type NO_PROPOSAL_CHOSEN');
    N('negotiation failure');
    return fail(`Phase 1 proposal mismatch (NO_PROPOSAL_CHOSEN): we offered [${props.join(' ')}] DH [${dh.join(' ')}]; the peer accepts [${BRANCH.p1.proposals.join(' ')}] DH [${BRANCH.p1.dhgrp.join(' ')}]`);
  }
  N(`received IKE msg (SA_INIT): ${rgw}:500->${oif.ipStr}:500, len=432`);
  N(`proposal chosen: ${prop} DH group ${grp}`);
  N('initiator: sending AUTH request');
  if (s('psksecret') !== BRANCH.p1.psk) {
    N('received notify type AUTHENTICATION_FAILED');
    N('schedule delete of IKE SA');
    return fail('Pre-shared key mismatch (AUTHENTICATION_FAILED)');
  }
  N('received AUTH response');
  N('auth verify done');
  N(`established IKE SA ${(0x5c3e7a11 + seq).toString(16)}/${(0x9a1f00d2 + seq).toString(16)}`);
  st.p1Up = true;

  for (const e of p2s) {
    const t = (n: string) => str(P2, e.f, n);
    const src = t('src-subnet');
    const dst = t('dst-subnet');
    const P = (m: string) => ike.push(`ike 0:${name}:${seq}:${e.key}:${seq + 1}: ${m}`);
    const p2props = list(P2, e.f, 'proposal').length ? list(P2, e.f, 'proposal') : P2_DEFAULT_PROPOSALS;
    const pfs = t('pfs') === 'enable';
    const ok = p2props.some((p) => BRANCH.p2.proposals.includes(p)) && pfs === BRANCH.p2.pfs && (!pfs || list(P2, e.f, 'dhgrp').some((g) => BRANCH.p2.dhgrp.includes(g)));
    P(`initiator: sending CREATE_CHILD_SA, selectors ${fmtCidr(parseIpMask(src)!)} -> ${fmtCidr(parseIpMask(dst)!)}`);
    if (!ok) {
      P('received notify type NO_PROPOSAL_CHOSEN');
      st.p2.push({ name: e.key, up: false, src, dst, error: `Phase 2 proposal/PFS mismatch (NO_PROPOSAL_CHOSEN): the peer wants [${BRANCH.p2.proposals.join(' ')}] with PFS DH group ${BRANCH.p2.dhgrp.join(' ')}` });
      continue;
    }
    const srcOk = isAny(src) || sameNet(src, HQ_LAN);
    const dstOk = isAny(dst) || sameNet(dst, BRANCH_LAN);
    if (!srcOk || !dstOk) {
      P('received notify type TS_UNACCEPTABLE');
      st.p2.push({ name: e.key, up: false, src, dst, error: `Selector mismatch (TS_UNACCEPTABLE): the peer expects local ${BRANCH.p2.remote} ↔ remote ${BRANCH.lan}` });
      continue;
    }
    const eff = { src: `${BRANCH.p2.remote.split('/')[0]} 255.255.255.0`, dst: `${BRANCH.lan.split('/')[0]} 255.255.255.0` };
    if (isAny(src) || isAny(dst)) P('selectors narrowed by responder');
    P(`CHILD SA added, selectors ${BRANCH.p2.remote} <-> ${BRANCH.lan}`);
    st.p2.push({ name: e.key, up: true, src: eff.src, dst: eff.dst });
  }
  if (!p2s.length) st.error = 'Phase 1 is up but no phase 2 selector is configured';
  else if (!st.p2.some((p) => p.up)) st.error = st.p2.find((p) => p.error)?.error;
  st.up = st.p2.some((p) => p.up);
  return st;
}

export function evalTunnels(c: Config, net: Net): Record<string, TunnelState> {
  const out: Record<string, TunnelState> = {};
  for (const e of entries(c, 'vpn ipsec phase1-interface')) out[e.key] = evalTunnel(c, net, e.key, e.f);
  return out;
}

/** Selector (phase 2) that carries this flow, if any. */
export function selectorFor(t: TunnelState, srcN: number, dstN: number): P2State | undefined {
  return t.p2.find((p) => {
    if (!p.up) return false;
    const s = parseIpMask(p.src)!;
    const d = parseIpMask(p.dst)!;
    return inNet(srcN, s.ip, s.prefix) && inNet(dstN, d.ip, d.prefix);
  });
}

/** Every phase 1 has a matching tunnel interface in "config system interface", as on FortiOS. */
export function syncTunnelInterfaces(c: Config) {
  const P1 = def('vpn ipsec phase1-interface');
  const I = def('system interface');
  const t = tableOf(c, 'system interface');
  const p1 = entries(c, 'vpn ipsec phase1-interface');
  for (const e of p1) {
    let row = t.entries.find((x) => x.key === e.key);
    if (!row) {
      row = { key: e.key, f: { vdom: 'root', type: 'tunnel' } };
      t.entries.push(row);
    }
    row.f.type = 'tunnel';
    const parent = str(P1, e.f, 'interface');
    if (parent) row.f.interface = parent;
  }
  t.entries = t.entries.filter((x) => !(str(I, x.f, 'type') === 'tunnel' && str(I, x.f, 'interface') && !p1.some((p) => p.key === x.key)));
}

// ---------- SSL-VPN ----------

export interface SslResult {
  ok: boolean;
  msg: string;
  steps: string[];
  ip?: string;
  groups?: string[];
  portal?: string;
}

export function sslSettingsField(c: Config, name: string): string {
  const o = c['vpn ssl settings'];
  return str(def('vpn ssl settings'), o?.kind === 'object' ? o.f : {}, name);
}

/** What happens when FortiClient on the remote laptop connects to gw:port with user/password. */
export function sslConnect(c: Config, net: Net, gw: string, port: number, user: string, pw: string, used: string[]): SslResult {
  const S = def('vpn ssl settings');
  const o = c['vpn ssl settings'];
  const f = o?.kind === 'object' ? o.f : {};
  const steps: string[] = [];
  const res = (ok: boolean, msg: string, extra: Partial<SslResult> = {}): SslResult => ({ ok, msg, steps, ...extra });
  if (str(S, f, 'status') !== 'enable') return res(false, 'Unable to establish the VPN connection. SSL-VPN is disabled on the FortiGate.');
  const srcIf = list(S, f, 'source-interface');
  const listenIf = net.ifList.find((i) => i.ipStr === gw && i.up);
  if (!listenIf) return res(false, `Unable to establish the VPN connection. ${gw} is not reachable (it is not a FortiGate interface address).`);
  if (!srcIf.includes(listenIf.name) && !srcIf.includes('any')) return res(false, `Unable to establish the VPN connection. The server did not respond (-5): SSL-VPN is not listening on ${listenIf.name}. Add it to "Listen on Interface(s)".`);
  const sslPort = Number(str(S, f, 'port'));
  if (port !== sslPort) return res(false, `Unable to establish the VPN connection. The server did not respond (-5): nothing is listening on TCP/${port} (SSL-VPN uses ${sslPort}).`);
  const adminPort = Number(str(def('system global'), c['system global']?.kind === 'object' ? c['system global'].f : {}, 'admin-sport'));
  if (sslPort === adminPort && listenIf.allowaccess.includes('https')) return res(false, `Port conflict: TCP/${sslPort} is also the HTTPS admin port on ${listenIf.name}. Change the SSL-VPN port (e.g. 10443) or the admin port.`);
  steps.push(`TLS connection to ${gw}:${port} established (server certificate ${str(S, f, 'servercert')})`);
  const srcAddr = list(S, f, 'source-address');
  if (srcAddr.length && !srcAddr.some((a) => addrMatches(c, a, ipToInt('198.51.100.88')!))) return res(false, 'Permission denied: your source address is not in "Restrict access" (source-address).');

  const a = authenticate(c, user, pw);
  steps.push(...a.steps);
  if (!a.ok) return res(false, `Permission denied (-455): ${a.msg}`);
  const R = S.fields.find((x) => x.name === 'authentication-rule')!.sub!;
  const rule = (sub(f, 'authentication-rule')?.entries ?? []).find((r) => list(R, r.f, 'users').includes(user) || list(R, r.f, 'groups').some((g) => a.groups.includes(g)));
  const portal = rule ? str(R, rule.f, 'portal') : str(S, f, 'default-portal');
  if (!portal) return res(false, 'Permission denied (-455): no authentication rule maps this user or group to a portal.');
  steps.push(rule ? `Authentication rule matched: portal "${portal}"` : `No rule matched, using default portal "${portal}"`);
  const pol = entries(c, 'firewall policy').find((p) => {
    const P = def('firewall policy');
    return list(P, p.f, 'srcintf').includes('ssl.root') && str(P, p.f, 'status') === 'enable' && (list(P, p.f, 'users').includes(user) || list(P, p.f, 'groups').some((g) => a.groups.includes(g)));
  });
  if (!pol) return res(false, 'Permission denied (-455): no firewall policy from ssl.root includes this user or group. The FortiGate checks for one at login.');
  const W = def('vpn ssl web portal');
  const pe = find(c, 'vpn ssl web portal', portal);
  if (!pe || str(W, pe.f, 'tunnel-mode') !== 'enable') return res(false, `Portal "${portal}" does not have tunnel mode enabled, so FortiClient cannot connect (only the web portal would work).`);
  const pools = list(W, pe.f, 'ip-pools').length ? list(W, pe.f, 'ip-pools') : list(S, f, 'tunnel-ip-pools');
  let ip: string | undefined;
  for (const name of pools) {
    const A = def('firewall address');
    const ae = find(c, 'firewall address', name);
    if (!ae) continue;
    const range = str(A, ae.f, 'type') === 'iprange' ? parseIpRange(`${str(A, ae.f, 'start-ip')}-${str(A, ae.f, 'end-ip')}`) : null;
    if (!range) continue;
    for (let n = range[0]; n <= range[1] && !ip; n++) {
      const cand = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      if (!used.includes(cand)) ip = cand;
    }
    if (ip) break;
  }
  if (!ip) return res(false, 'No tunnel IP available: configure an IP pool (address range) in the portal or SSL-VPN settings.');
  steps.push(`Tunnel up, assigned IP ${ip}`);
  return res(true, `Connected. Tunnel IP ${ip}`, { ip, groups: a.groups, portal });
}

/** Does the laptop send this destination into the SSL-VPN tunnel (split tunneling)? */
export function sslTunnels(c: Config, portal: string, dstN: number): boolean {
  const W = def('vpn ssl web portal');
  const pe = find(c, 'vpn ssl web portal', portal);
  if (!pe) return false;
  if (str(W, pe.f, 'split-tunneling') !== 'enable') return true;
  const routes = list(W, pe.f, 'split-tunneling-routing-address');
  if (routes.length) return routes.some((a) => addrMatches(c, a, dstN));
  // Without explicit routes FortiOS pushes the destinations of the ssl.root policies.
  const P = def('firewall policy');
  return entries(c, 'firewall policy')
    .filter((p) => list(P, p.f, 'srcintf').includes('ssl.root'))
    .some((p) => list(P, p.f, 'dstaddr').some((a) => a !== 'all' && addrMatches(c, a, dstN)));
}
