// Firewall user authentication: local users, LDAP and RADIUS against the lab directory (AD-Server).
import type { Config } from './types';
import { def, entries, find, list, str, sub } from './config';
import { ipToInt } from './ip';
import { buildNet, lookupRoute } from './net';
import { DIRECTORY } from './topology';

export interface CheckResult {
  ok: boolean;
  msg: string;
  steps: string[];
}

const dirUser = (u: string) => DIRECTORY.users.find((x) => x.user.toLowerCase() === u.toLowerCase());

/** Can the FortiGate reach the directory server at all? */
function reach(c: Config, server: string, port: number, proto: 'tcp' | 'udp'): string | null {
  const ip = server === `dc.${DIRECTORY.domain}` ? DIRECTORY.ip : server;
  const n = ipToInt(ip);
  if (n === null) return `cannot resolve server "${server}"`;
  const net = buildNet(c);
  const r = lookupRoute(net, n);
  if (!r) return `no route to ${ip}`;
  const h = net.hosts.find((x) => x.ok && x.ipN === n && x.logical === r.device);
  if (!h) return `${ip} does not answer (no such host on ${r.device})`;
  if (!h.host.listen.some((l) => l.proto === proto && l.port === port)) return `${ip} does not listen on ${proto.toUpperCase()}/${port}`;
  return null;
}

/** Validate an LDAP server object, optionally authenticating a user. */
export function ldapCheck(c: Config, name: string, user?: string, pw?: string): CheckResult & { groups?: string[] } {
  const L = def('user ldap');
  const e = find(c, 'user ldap', name);
  const steps: string[] = [];
  if (!e) return { ok: false, msg: `LDAP server "${name}" does not exist`, steps };
  const s = (n: string) => str(L, e.f, n);
  const secure = s('secure');
  const port = Number(s('port'));
  steps.push(`Connecting to ${s('server')}:${port} (${secure === 'ldaps' ? 'LDAPS' : secure === 'starttls' ? 'STARTTLS' : 'clear text'})`);
  const r = reach(c, s('server'), port, 'tcp');
  if (r) return { ok: false, msg: `Can't contact LDAP server: ${r}`, steps };
  if ((secure === 'ldaps') !== (port === 636)) return { ok: false, msg: `Can't contact LDAP server: ${secure === 'ldaps' ? 'LDAPS normally uses port 636' : 'port 636 expects LDAPS (set secure ldaps)'}`, steps };
  steps.push('TCP connection established');
  const type = s('type');
  const dn = s('dn').toLowerCase();
  if (type === 'anonymous') return { ok: false, msg: 'Operations error: the server does not allow anonymous search (bind type must be "regular")', steps };
  if (type === 'regular') {
    if (s('username').toLowerCase() !== DIRECTORY.bindDn.toLowerCase() || s('password') !== DIRECTORY.bindPw) return { ok: false, msg: 'Invalid credentials: the bind DN or password is wrong', steps };
    steps.push(`Bound as ${s('username')}`);
    if (dn !== DIRECTORY.base.toLowerCase() && dn !== DIRECTORY.usersDn.toLowerCase()) return { ok: false, msg: `No such object: distinguished name "${s('dn')}" not found`, steps };
  } else if (dn !== DIRECTORY.usersDn.toLowerCase()) return { ok: false, msg: `Simple bind builds the user DN from "${s('cnid')}=<user>,${s('dn')}". With Active Directory set dn to ${DIRECTORY.usersDn}, or use type regular.`, steps };
  if (user === undefined) return { ok: true, msg: 'Successful', steps };
  const du = dirUser(user);
  const cnid = s('cnid').toLowerCase();
  if (!['cn', 'samaccountname', 'uid'].includes(cnid)) return { ok: false, msg: `User not found: no entry where ${s('cnid')}=${user}`, steps };
  if (!du) return { ok: false, msg: `User "${user}" not found in ${s('dn')}`, steps };
  if (du.pw !== pw) return { ok: false, msg: 'Invalid credentials for user', steps };
  steps.push(`Found ${cnid}=${user}`, 'User password accepted');
  return { ok: true, msg: 'Successful', steps, groups: du.groups };
}

export function radiusCheck(c: Config, name: string, user?: string, pw?: string): CheckResult & { groups?: string[] } {
  const R = def('user radius');
  const e = find(c, 'user radius', name);
  const steps: string[] = [];
  if (!e) return { ok: false, msg: `RADIUS server "${name}" does not exist`, steps };
  const port = Number(str(R, e.f, 'radius-port')) || 1812;
  const r = reach(c, str(R, e.f, 'server'), port, 'udp');
  if (r) return { ok: false, msg: `Can't contact RADIUS server: ${r}`, steps };
  if (str(R, e.f, 'secret') !== DIRECTORY.radiusSecret) return { ok: false, msg: 'No response from RADIUS server: the shared secret does not match (the server silently drops the request)', steps };
  steps.push('RADIUS server reachable, shared secret OK');
  if (user === undefined) return { ok: true, msg: 'Successful', steps };
  const du = dirUser(user);
  if (!du || du.pw !== pw) return { ok: false, msg: 'Access-Reject: invalid username or password', steps };
  return { ok: true, msg: 'Access-Accept', steps, groups: du.groups };
}

export interface LoginResult {
  ok: boolean;
  msg: string;
  user: string;
  groups: string[];
  method?: 'local' | 'ldap' | 'radius';
  server?: string;
  steps: string[];
}

/** What the FortiGate does when a user submits the authentication portal form. */
export function authenticate(c: Config, user: string, pw: string): LoginResult {
  const U = def('user local');
  const GR = def('user group');
  const M = GR.fields.find((f) => f.name === 'match')!.sub!;
  const steps: string[] = [];
  const res = (ok: boolean, msg: string, extra: Partial<LoginResult> = {}): LoginResult => ({ ok, msg, user, groups: [], steps, ...extra });
  const lu = find(c, 'user local', user);
  let method: LoginResult['method'];
  let server: string | undefined;
  let dirGroups: string[] = [];

  if (lu) {
    if (str(U, lu.f, 'status') !== 'enable') return res(false, `User ${user} is disabled`);
    const type = str(U, lu.f, 'type');
    if (type === 'password') {
      if (str(U, lu.f, 'passwd') !== pw) return res(false, 'Authentication failed: wrong password');
      method = 'local';
      steps.push(`Local user ${user}: password correct`);
    } else {
      server = str(U, lu.f, type === 'ldap' ? 'ldap-server' : 'radius-server');
      const r = type === 'ldap' ? ldapCheck(c, server, user, pw) : radiusCheck(c, server, user, pw);
      steps.push(...r.steps);
      if (!r.ok) return res(false, `Authentication failed (${server}): ${r.msg}`);
      method = type as 'ldap' | 'radius';
      dirGroups = r.groups ?? [];
    }
  }

  const groups: string[] = [];
  for (const g of entries(c, 'user group')) {
    if (str(GR, g.f, 'group-type') !== 'firewall') continue;
    const members = list(GR, g.f, 'member');
    if (lu && members.includes(user) && method) {
      groups.push(g.key);
      continue;
    }
    for (const m of members) {
      const isLdap = !!find(c, 'user ldap', m);
      const isRadius = !!find(c, 'user radius', m);
      if (!isLdap && !isRadius) continue;
      if (lu && str(U, lu.f, 'type') === 'password') continue; // a local password user never falls back to remote servers
      let grp = dirGroups;
      if (!method || server !== m) {
        const r = isLdap ? ldapCheck(c, m, user, pw) : radiusCheck(c, m, user, pw);
        if (!r.ok) {
          steps.push(`Group ${g.key}: ${m}: ${r.msg}`);
          continue;
        }
        steps.push(...r.steps.map((x) => `${m}: ${x}`));
        grp = r.groups ?? [];
        method ??= isLdap ? 'ldap' : 'radius';
        server ??= m;
      }
      const matches = (sub(g.f, 'match')?.entries ?? []).filter((x) => str(M, x.f, 'server-name') === m);
      if (matches.length && !matches.some((x) => grp.some((dg) => dg.toLowerCase() === str(M, x.f, 'group-name').toLowerCase()))) {
        steps.push(`Group ${g.key}: ${user} is not in the required remote group(s) ${matches.map((x) => str(M, x.f, 'group-name')).join(', ')}`);
        continue;
      }
      groups.push(g.key);
      break;
    }
  }

  if (!method) return res(false, lu ? 'Authentication failed' : `Authentication failed: no local user "${user}" and no remote server in any user group accepted the credentials`);
  steps.push(groups.length ? `Member of firewall group(s): ${groups.join(', ')}` : 'Authenticated, but not a member of any firewall user group');
  return res(true, groups.length ? 'Authentication successful' : 'Authenticated, but the user is in no user group, so identity-based policies will not match', { groups, method, server });
}
