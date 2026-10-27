// Administrators, access profiles (permissions) and trusted hosts.
import type { Config } from './types';
import { def, entries, find, str } from './config';
import { inNet, ipToInt, parseIpMask } from './ip';
import { sha256 } from './sha256';

// ---------- admin passwords ----------
// Stored like FortiOS: a one-way hash ("SH2" + 16 hex salt + 64 hex SHA-256), never the plain text.

export const isPwHash = (s: string) => /^SH2[0-9a-f]{80}$/.test(s);

export function hashAdminPw(pw: string): string {
  const salt = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `SH2${salt}${sha256(salt + pw)}`;
}

/** Does the typed password match the stored one? An empty stored password matches only an empty one. */
export function adminPwMatches(stored: string, pw: string): boolean {
  if (!isPwHash(stored)) return stored === pw;
  const salt = stored.slice(3, 19);
  return sha256(salt + pw) === stored.slice(19);
}

/** Hash every admin password still in plain text (typed in the GUI or CLI, or from an older save). */
export function hashAdminPasswords(c: Config) {
  for (const a of entries(c, 'system admin')) {
    const pw = a.f.password;
    if (typeof pw === 'string' && pw !== '' && !isPwHash(pw)) a.f.password = hashAdminPw(pw);
  }
}

/** A factory-fresh unit: the admin account exists and has no password yet. */
export function needsAdminSetup(c: Config): boolean {
  const a = find(c, 'system admin', 'admin');
  return !!a && str(def('system admin'), a.f, 'password') === '';
}

export type Perm = 'none' | 'read' | 'read-write';

export const PERM_GROUPS: { id: string; label: string; covers: string }[] = [
  { id: 'secfabgrp', label: 'Security Fabric', covers: 'Fabric connectors' },
  { id: 'ftviewgrp', label: 'FortiView', covers: 'FortiView monitors' },
  { id: 'authgrp', label: 'User & Device', covers: 'Users, groups, LDAP/RADIUS' },
  { id: 'fwgrp', label: 'Firewall', covers: 'Policies, addresses, services, VIPs, IP pools' },
  { id: 'loggrp', label: 'Log & Report', covers: 'Log settings and logs' },
  { id: 'netgrp', label: 'Network', covers: 'Interfaces, DNS, routing, SD-WAN' },
  { id: 'sysgrp', label: 'System', covers: 'Settings, administrators, HA, SNMP, firmware' },
  { id: 'utmgrp', label: 'Security Profile', covers: 'AntiVirus, web filter, IPS, SSL inspection' },
  { id: 'vpngrp', label: 'VPN', covers: 'IPsec and SSL-VPN' },
];

const UTM = ['antivirus profile', 'webfilter profile', 'webfilter urlfilter', 'dnsfilter profile', 'application list', 'ips sensor', 'firewall ssl-ssh-profile'];
const NET = ['system interface', 'system zone', 'system dns', 'system dhcp server', 'system virtual-switch', 'system sdwan'];

/** Which permission group protects a config path. */
export function pathGroup(path: string): string {
  if (UTM.includes(path)) return 'utmgrp';
  if (path.startsWith('firewall ')) return 'fwgrp';
  if (path.startsWith('vpn ')) return 'vpngrp';
  if (path.startsWith('user ')) return 'authgrp';
  if (path.startsWith('log ')) return 'loggrp';
  if (path.startsWith('router ') || NET.includes(path)) return 'netgrp';
  return 'sysgrp';
}

/** Menu group id -> permission group (dashboard is always visible). */
export const MENU_PERM: Record<string, string | undefined> = { network: 'netgrp', policy: 'fwgrp', security: 'utmgrp', vpn: 'vpngrp', user: 'authgrp', system: 'sysgrp', log: 'loggrp' };

export const groupLabel = (g: string) => PERM_GROUPS.find((x) => x.id === g)?.label ?? g;

export function adminProfile(c: Config, user: string): string {
  const a = find(c, 'system admin', user);
  return a ? str(def('system admin'), a.f, 'accprofile') : '';
}

export function profilePerms(c: Config, profile: string): Record<string, Perm> {
  const P = def('system accprofile');
  const e = find(c, 'system accprofile', profile);
  const out: Record<string, Perm> = {};
  for (const g of PERM_GROUPS) out[g.id] = (e ? str(P, e.f, g.id) : 'none') as Perm;
  if (profile === 'super_admin' && !e) for (const g of PERM_GROUPS) out[g.id] = 'read-write';
  return out;
}

export function trustedHosts(c: Config, user: string): string[] {
  const A = def('system admin');
  const a = find(c, 'system admin', user);
  if (!a) return [];
  return ['trusthost1', 'trusthost2', 'trusthost3'].map((k) => str(A, a.f, k)).filter((t) => t !== '0.0.0.0 0.0.0.0');
}

export interface AdminLoginResult {
  ok: boolean;
  reason: string; // logged (detailed)
  mustChange: boolean;
}

/** Credential + trusted-host check (reachability/admin access is checked by the packet engine). */
export function adminLogin(c: Config, user: string, pw: string, srcIp: string): AdminLoginResult {
  const A = def('system admin');
  const a = find(c, 'system admin', user);
  if (!a) return { ok: false, reason: `invalid user name "${user}"`, mustChange: false };
  const trusted = trustedHosts(c, user);
  const n = ipToInt(srcIp) ?? 0;
  if (trusted.length && !trusted.some((t) => {
    const net = parseIpMask(t);
    return !!net && inNet(n, net.ip, net.prefix);
  }))
    return { ok: false, reason: `${srcIp} is not a trusted host for ${user} (trusted: ${trusted.map((t) => { const n = parseIpMask(t); return n ? `${t.split(' ')[0]}/${n.prefix}` : t; }).join(', ')})`, mustChange: false };
  const stored = str(A, a.f, 'password');
  if (!adminPwMatches(stored, pw)) return { ok: false, reason: 'invalid password', mustChange: false };
  return { ok: true, reason: '', mustChange: stored === '' };
}

/** Top-level config paths whose content differs. */
export function changedPaths(a: Config, b: Config): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

/** Null if the profile may write every changed path, else a FortiOS-style denial message. */
export function writeDenied(c: Config, user: string, paths: string[]): string | null {
  const prof = adminProfile(c, user);
  const perms = profilePerms(c, prof);
  for (const p of paths) {
    const g = pathGroup(p);
    if (perms[g] !== 'read-write') return `Permission denied: profile "${prof}" has ${perms[g] === 'read' ? 'read-only' : 'no'} access to ${groupLabel(g)} (${p}).`;
  }
  return null;
}
