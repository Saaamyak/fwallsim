// Guided labs and troubleshooting challenges. Each task is checked live against the config and
// by running real simulated traffic, so the learner gets a tick the moment it works.
import type { Config, Fields } from '../engine/types';
import { def, entries, find, gobj, list, newUuid, objectOf, str, sub, tableOf } from '../engine/config';
import { factoryConfig, starterConfig } from '../engine/defaults';
import { policies } from '../engine/views';
import { buildNet, type Net } from '../engine/net';
import { runTraffic, type TrafficRequest } from '../engine/packet';
import type { Runtime, SimResult } from '../engine/runtime';
import type { LabState } from '../engine/lab';
import { ldapCheck } from '../engine/auth';
import { syncTunnelInterfaces } from '../engine/vpn';
import { adminProfile, profilePerms, trustedHosts } from '../engine/admin';
import { inNet, ipToInt, parseIpMask } from '../engine/ip';

export interface CheckCtx {
  c: Config;
  rt: Runtime;
  net: Net;
  send: (r: TrafficRequest) => SimResult;
}

export interface Task {
  title: string;
  how: string; // where to click / what to do
  check: (x: CheckCtx) => boolean;
}

export type Level = 'Beginner' | 'Intermediate' | 'Advanced' | 'Challenge';

export interface Lab {
  id: string;
  title: string;
  level: Level;
  minutes: number;
  topic: string;
  intro: string;
  build: () => Config;
  lab?: Partial<LabState>;
  startPage?: string;
  tasks: Task[];
  hints?: string[]; // challenges: revealed one at a time
  solution?: string[];
}

// ---------- helpers ----------

const pols = (c: Config) => policies(c).filter((p) => p.status);
const sendOk = (x: CheckCtx, srcHost: string, dst: string, proto: TrafficRequest['proto'] = 'tcp', dport = 443) => x.send({ srcHost, dst, proto, dport }).ok;
const hostIp = (x: CheckCtx, id: string) => x.net.hosts.find((h) => h.host.id === id)?.ip ?? '';

function addPolicy(c: Config, f: Fields): string {
  const t = tableOf(c, 'firewall policy');
  const key = String(t.entries.reduce((m, e) => Math.max(m, Number(e.key)), 0) + 1);
  t.entries.push({ key, f: { uuid: newUuid(), schedule: 'always', ...f } });
  return key;
}
function addAddr(c: Config, name: string, subnet: string) {
  tableOf(c, 'firewall address').entries.push({ key: name, f: { uuid: newUuid(), subnet } });
}
function patchPolicy(c: Config, id: string, f: Fields) {
  const e = find(c, 'firewall policy', id);
  if (e) Object.assign(e.f, f);
}
const lanOut = (c: Config) => addPolicy(c, { name: 'LAN-to-Internet', srcintf: ['internal'], dstintf: ['wan1'], action: 'accept', srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], nat: 'enable', logtraffic: 'all' });

function vpnBase(c: Config, psk = 'Branch-PSK-2026', route = true): Config {
  tableOf(c, 'vpn ipsec phase1-interface').entries.push({ key: 'to-branch', f: { interface: 'wan1', 'ike-version': '2', 'remote-gw': '198.51.100.200', psksecret: psk } });
  tableOf(c, 'vpn ipsec phase2-interface').entries.push({ key: 'to-branch', f: { phase1name: 'to-branch', 'src-subnet': '192.168.1.0 255.255.255.0', 'dst-subnet': '10.20.0.0 255.255.255.0' } });
  addAddr(c, 'HQ-LAN', '192.168.1.0 255.255.255.0');
  addAddr(c, 'Branch-LAN', '10.20.0.0 255.255.255.0');
  const R = tableOf(c, 'router static');
  if (route) R.entries.push({ key: String(R.entries.length + 1), f: { dst: '10.20.0.0 255.255.255.0', device: 'to-branch' } });
  R.entries.push({ key: String(R.entries.length + 1), f: { dst: '10.20.0.0 255.255.255.0', blackhole: 'enable', distance: '254' } });
  addPolicy(c, { name: 'HQ-to-Branch', srcintf: ['internal'], dstintf: ['to-branch'], action: 'accept', srcaddr: ['HQ-LAN'], dstaddr: ['Branch-LAN'], service: ['ALL'] });
  addPolicy(c, { name: 'Branch-to-HQ', srcintf: ['to-branch'], dstintf: ['internal'], action: 'accept', srcaddr: ['Branch-LAN'], dstaddr: ['HQ-LAN'], service: ['ALL'] });
  syncTunnelInterfaces(c);
  return c;
}

function sdwanBase(c: Config, hcServer = '8.8.8.8'): Config {
  objectOf(c, 'system sdwan').f = {
    status: 'enable',
    zone: { kind: 'table', entries: [{ key: 'virtual-wan-link', f: {} }] },
    members: { kind: 'table', entries: [{ key: '1', f: { interface: 'wan1', gateway: '203.0.113.1' } }, { key: '2', f: { interface: 'wan2', gateway: '198.18.10.1' } }] },
    'health-check': { kind: 'table', entries: [{ key: 'Internet', f: { server: hcServer === 'gateways' ? ['203.0.113.1'] : [hcServer], members: ['1'], sla: { kind: 'table', entries: [{ key: '1', f: { 'latency-threshold': '50', 'jitter-threshold': '20', 'packetloss-threshold': '5' } }] } } }] },
  };
  tableOf(c, 'router static').entries.push({ key: String(entries(c, 'router static').length + 1), f: { 'sdwan-zone': ['virtual-wan-link'] } });
  for (const p of entries(c, 'firewall policy')) {
    const d = p.f.dstintf;
    if (Array.isArray(d) && d.includes('wan1')) p.f.dstintf = ['virtual-wan-link'];
  }
  return c;
}

const routeActive = (x: CheckCtx, prefix: string, type?: string) => {
  const n = parseIpMask(prefix)!;
  return x.net.routes.some((r) => r.active && r.net === n.ip && r.prefix === n.prefix && (!type || r.type === type));
};

// ---------- labs ----------

export const LABS: Lab[] = [
  {
    id: 'l1-basics',
    title: 'First login and system basics',
    level: 'Beginner',
    minutes: 10,
    topic: 'GUI, System settings, local-in',
    intro: 'Get comfortable with the GUI. You will rename the firewall, change an admin setting, and prove you can reach the FortiGate from the LAN.',
    build: factoryConfig,
    startPage: 'dash-status',
    tasks: [
      { title: 'Change the hostname to HQ-FGT', how: 'System > Settings > Host name, then Apply. Watch the header and the CLI prompt change.', check: (x) => gobj(x.c, 'system global', 'hostname') === 'HQ-FGT' },
      { title: 'Set the admin idle timeout to 15 minutes', how: 'System > Settings > Idle timeout.', check: (x) => gobj(x.c, 'system global', 'admintimeout') === '15' },
      { title: 'From PC1, ping the FortiGate (192.168.1.99)', how: 'Lab > Traffic Generator: Source PC1-Admin, Destination 192.168.1.99, application Ping, Send traffic. The Packet Walk shows it is local-in traffic.', check: (x) => x.rt.history.some((h) => h.ok && h.summary.includes('192.168.1.99') && h.summary.includes('PING')) },
      { title: 'Open the CLI and run "get system status"', how: 'Click the >_ button in the header, type get system status and press Enter.', check: () => cliRan(/^get\s+sys\S*\s+stat/) },
    ],
  },
  {
    id: 'l2-first-policy',
    title: 'Your first firewall policy: LAN to Internet',
    level: 'Beginner',
    minutes: 15,
    topic: 'Firewall policy, NAT, implicit deny',
    intro: 'A new FortiGate blocks everything through it (the Implicit Deny). Build the policy that lets the office reach the internet, with source NAT so replies can come back.',
    build: factoryConfig,
    startPage: 'pol-policy',
    tasks: [
      { title: 'Create an ACCEPT policy from internal to wan1', how: 'Policy & Objects > Firewall Policy > Create New. Incoming internal, Outgoing wan1, Source all, Destination all, Schedule always, Service ALL, Action ACCEPT.', check: (x) => pols(x.c).some((p) => p.action === 'accept' && p.srcintf.includes('internal') && p.dstintf.includes('wan1')) },
      { title: 'Enable NAT on that policy', how: 'In the same policy, Firewall / Network Options > NAT: on (Use Outgoing Interface Address).', check: (x) => pols(x.c).some((p) => p.action === 'accept' && p.srcintf.includes('internal') && p.dstintf.includes('wan1') && p.nat) },
      { title: 'PC1 can ping 8.8.8.8', how: 'Lab > Traffic Generator > quick test "PC1 pings 8.8.8.8". Look at the Source NAT step in the Packet Walk.', check: (x) => sendOk(x, 'pc1', '8.8.8.8', 'icmp', 0) },
      { title: 'PC1 can browse www.example.com', how: 'Quick test "PC1 browses www.example.com". This needs DNS first. The Packet Walk shows the DNS query too.', check: (x) => sendOk(x, 'pc1', 'www.example.com') },
    ],
  },
  {
    id: 'l3-logging',
    title: 'Logs: seeing what the firewall did',
    level: 'Beginner',
    minutes: 10,
    topic: 'Log Allowed Traffic, implicit deny logging, Forward Traffic log',
    intro: 'By default a policy only logs security events, so normal allowed traffic does not show up in the logs. Turn on full logging and find both an allowed and a denied entry.',
    build: () => {
      const c = starterConfig();
      for (const p of entries(c, 'firewall policy')) delete p.f.logtraffic;
      objectOf(c, 'log setting').f['fwpolicy-implicit-log'] = 'disable';
      return c;
    },
    startPage: 'pol-policy',
    tasks: [
      { title: 'Policy 1 logs All Sessions', how: 'Edit policy 1 (LAN-to-Internet) > Logging Options > Log Allowed Traffic: All Sessions.', check: (x) => policies(x.c).find((p) => p.id === '1')?.logtraffic === 'all' },
      { title: 'Log violation traffic on the Implicit Deny', how: 'Firewall Policy list: right-click the Implicit Deny row > Enable "Log Violation Traffic" (or Log & Report > Log Settings).', check: (x) => gobj(x.c, 'log setting', 'fwpolicy-implicit-log') === 'enable' },
      { title: 'Produce an allowed Forward Traffic log', how: 'Send traffic from PC1 to the internet, then open Log & Report > Forward Traffic.', check: (x) => x.rt.trafficLogs.some((l) => l.subtype === 'forward' && l.action !== 'deny') },
      { title: 'Produce a denied log (policy 0)', how: 'Send traffic from Web-Server to PC1 (192.168.1.110): there is no dmz → internal policy, so the Implicit Deny drops it.', check: (x) => x.rt.trafficLogs.some((l) => l.subtype === 'forward' && l.action === 'deny' && l.policyid === 0) },
    ],
  },
  {
    id: 'l4-objects',
    title: 'Objects: addresses and service groups',
    level: 'Beginner',
    minutes: 15,
    topic: 'Address objects, service groups, least privilege',
    intro: 'The LAN currently has "all to all, ALL services". Tighten it so the LAN may only browse the web, using objects instead of raw values.',
    build: () => {
      const c = factoryConfig();
      lanOut(c);
      return c;
    },
    startPage: 'pol-address',
    tasks: [
      { title: 'Create address LAN-Net = 192.168.1.0/24', how: 'Policy & Objects > Addresses > Create New > Address. Type Subnet.', check: (x) => (find(x.c, 'firewall address', 'LAN-Net')?.f.subnet as string | undefined)?.startsWith('192.168.1.0 255.255.255.0') ?? false },
      { title: 'Create service group Web-Basic with DNS, HTTP, HTTPS', how: 'Policy & Objects > Services > Create New > Service Group.', check: (x) => ['DNS', 'HTTP', 'HTTPS'].every((s) => list(def('firewall service group'), find(x.c, 'firewall service group', 'Web-Basic')?.f ?? {}, 'member').includes(s)) },
      { title: 'Policy 1 uses LAN-Net as source and Web-Basic as service', how: 'Edit policy 1: replace Source all with LAN-Net and Service ALL with Web-Basic.', check: (x) => { const p = policies(x.c).find((q) => q.id === '1'); return !!p && p.srcaddr.includes('LAN-Net') && p.service.includes('Web-Basic') && !p.service.includes('ALL'); } },
      { title: 'PC1 can still browse, but ping to 8.8.8.8 is now blocked', how: 'Test both from the Traffic Generator. Ping is not in Web-Basic, so it falls to the Implicit Deny.', check: (x) => sendOk(x, 'pc1', 'www.example.com') && !sendOk(x, 'pc1', '8.8.8.8', 'icmp', 0) },
    ],
  },
  {
    id: 'l5-vip',
    title: 'Publish a web server with a Virtual IP',
    level: 'Beginner',
    minutes: 20,
    topic: 'Destination NAT (VIP), inbound policy',
    intro: 'The company website runs on Web-Server (10.10.10.10, DMZ). Make it reachable from the internet on the wan1 address, for HTTP only.',
    build: () => {
      const c = factoryConfig();
      lanOut(c);
      return c;
    },
    startPage: 'pol-vip',
    tasks: [
      { title: 'Create a VIP: wan1 203.0.113.10 TCP/80 → 10.10.10.10:80', how: 'Policy & Objects > Virtual IPs > Create New. Interface wan1, External IP 203.0.113.10, Map to 10.10.10.10, Port Forwarding TCP 80 → 80.', check: (x) => entries(x.c, 'firewall vip').some((v) => list(def('firewall vip'), v.f, 'mappedip')[0] === '10.10.10.10') },
      { title: 'Create the inbound policy wan1 → dmz with the VIP as destination', how: 'Firewall Policy > Create New: Incoming wan1, Outgoing dmz, Source all, Destination = your VIP, Service HTTP, ACCEPT, NAT off.', check: (x) => pols(x.c).some((p) => p.action === 'accept' && p.srcintf.includes('wan1') && p.dstintf.includes('dmz') && p.dstaddr.some((d) => !!find(x.c, 'firewall vip', d))) },
      { title: 'Internet-User reaches http://203.0.113.10', how: 'Quick test "Internet user visits your website". The Packet Walk shows the DNAT step.', check: (x) => sendOk(x, 'user', '203.0.113.10', 'tcp', 80) },
      { title: 'SSH from the internet to the web server is still impossible', how: 'Send Attacker → 203.0.113.10 TCP/22. Only port 80 is forwarded.', check: (x) => !sendOk(x, 'attacker', '203.0.113.10', 'tcp', 22) },
    ],
  },
  {
    id: 'l6-order',
    title: 'Rule order matters',
    level: 'Intermediate',
    minutes: 15,
    topic: 'First-match policy lookup, policy order',
    intro: 'Someone added a policy to block YouTube for PC2, but PC2 can still watch it. Find out why and fix it without breaking anyone else.',
    build: () => {
      const c = factoryConfig();
      addAddr(c, 'PC2', '192.168.1.111 255.255.255.255');
      addAddr(c, 'YouTube-IP', '142.250.183.14 255.255.255.255');
      lanOut(c);
      addPolicy(c, { name: 'Block-PC2-YouTube', srcintf: ['internal'], dstintf: ['wan1'], action: 'deny', srcaddr: ['PC2'], dstaddr: ['YouTube-IP'], service: ['HTTPS'], logtraffic: 'all' });
      return c;
    },
    startPage: 'pol-policy',
    tasks: [
      { title: 'PC2 can no longer reach YouTube', how: 'Policies are checked top to bottom and the first match wins. Use By Sequence view and drag the block policy above LAN-to-Internet (or right-click > Move up).', check: (x) => !sendOk(x, 'pc2', 'www.youtube.com') },
      { title: 'PC1 can still reach YouTube', how: 'Send PC1 → www.youtube.com.', check: (x) => sendOk(x, 'pc1', 'www.youtube.com') },
      { title: 'PC2 can still browse other sites', how: 'Send PC2 → www.example.com.', check: (x) => sendOk(x, 'pc2', 'www.example.com') },
    ],
  },
  {
    id: 'l7-renumber',
    title: 'Change the LAN subnet',
    level: 'Intermediate',
    minutes: 20,
    topic: 'Interfaces, DHCP server, address objects',
    intro: 'Management wants the office LAN moved to 192.168.10.0/24, with the FortiGate at 192.168.10.1. Everything must keep working.',
    build: starterConfig,
    startPage: 'net-interfaces',
    tasks: [
      { title: 'internal is 192.168.10.1/24', how: 'Network > Interfaces > edit internal > IP/Netmask.', check: (x) => (find(x.c, 'system interface', 'internal')?.f.ip as string | undefined) === '192.168.10.1 255.255.255.0' },
      { title: 'The DHCP server hands out 192.168.10.x addresses', how: 'Same page: DHCP Server address range, e.g. 192.168.10.100 - 192.168.10.200.', check: (x) => hostIp(x, 'pc1').startsWith('192.168.10.') && hostIp(x, 'pc2').startsWith('192.168.10.') },
      { title: 'PC1 can browse www.example.com again', how: 'Hint: the policy source is the address object LAN-Subnet, which still says 192.168.1.0/24. Objects must follow the renumbering.', check: (x) => hostIp(x, 'pc1').startsWith('192.168.10.') && sendOk(x, 'pc1', 'www.example.com') },
    ],
  },
  {
    id: 'l8-harden',
    title: 'Harden administrative access',
    level: 'Intermediate',
    minutes: 20,
    topic: 'Admin profiles, trusted hosts, local-in policy',
    intro: 'HTTPS and SSH admin access are open on wan1 to the whole internet. Lock it down: an auditor account limited to the LAN, admin HTTPS only from the office IP (Internet-User, 198.51.100.77), and no SSH from outside.',
    build: () => {
      const c = starterConfig();
      const w = find(c, 'system interface', 'wan1')!;
      w.f.allowaccess = ['ping', 'https', 'ssh', 'fgfm'];
      return c;
    },
    startPage: 'sys-admins',
    tasks: [
      { title: 'Create admin "auditor" with a profile that can change nothing', how: 'System > Admin Profiles > Create New (set all to Read), then System > Administrators > Create New "auditor" with that profile.', check: (x) => !!find(x.c, 'system admin', 'auditor') && Object.values(profilePerms(x.c, adminProfile(x.c, 'auditor'))).every((p) => p !== 'read-write') },
      { title: 'auditor may only log in from the LAN (192.168.1.0/24)', how: 'Edit auditor > Restrict login to trusted hosts > 192.168.1.0/24.', check: (x) => { const t = trustedHosts(x.c, 'auditor'); return t.length > 0 && t.every((h) => { const n = parseIpMask(h); return !!n && inNet(n.ip, ipToInt('192.168.1.0')!, 24) && n.prefix >= 24; }); } },
      { title: 'Admin HTTPS on wan1: office yes, Attacker no', how: 'Policy & Objects > Local-In Policy: accept HTTPS from an address 198.51.100.77/32 on wan1, then deny HTTPS from all on wan1.', check: (x) => sendOk(x, 'user', '203.0.113.10', 'tcp', 443) && !sendOk(x, 'attacker', '203.0.113.10', 'tcp', 443) },
      { title: 'Nobody can SSH to wan1 from the internet', how: 'Remove SSH from wan1 Administrative Access (or add a local-in deny for SSH).', check: (x) => !sendOk(x, 'user', '203.0.113.10', 'tcp', 22) && !sendOk(x, 'attacker', '203.0.113.10', 'tcp', 22) },
    ],
  },
  {
    id: 'l9-ldap',
    title: 'Identity-based access with LDAP',
    level: 'Intermediate',
    minutes: 25,
    topic: 'LDAP server, user groups, identity-based policy',
    intro: 'Only the Sales team may use the internet. Connect the FortiGate to Active Directory (AD-Server 10.10.10.20) and make the internet policy require the Sales group. The directory details are on User & Authentication > LDAP Servers.',
    build: starterConfig,
    startPage: 'usr-ldap',
    tasks: [
      { title: 'An LDAP server object connects to AD successfully', how: 'User & Authentication > LDAP Servers > Create New, then Test Connectivity until it says Successful.', check: (x) => entries(x.c, 'user ldap').some((e) => ldapCheck(x.c, e.key).ok) },
      { title: 'A user group contains the LDAP server, limited to CN=Sales', how: 'User Groups > Create New: Members = your LDAP server, Remote Groups: CN=Sales,OU=Groups,DC=lab,DC=local.', check: (x) => entries(x.c, 'user group').some((g) => (sub(g.f, 'match')?.entries ?? []).some((m) => str(def('user group').fields.find((f) => f.name === 'match')!.sub!, m.f, 'group-name').toLowerCase().startsWith('cn=sales'))) },
      { title: 'Policy 1 requires that group', how: 'Edit policy 1 > Source: add the user group next to LAN-Subnet.', check: (x) => (policies(x.c).find((p) => p.id === '1')?.groups.length ?? 0) > 0 },
      { title: 'jsmith logs in on PC1 and can browse', how: 'Lab > Users: PC1, jsmith / Sales123!, Log in. Then send PC1 → www.example.com. Note: before login even DNS is refused, because DNS cannot show a login page. In production, add a DNS-only policy without groups above this one.', check: (x) => Object.values(x.rt.lab.auth).some((a) => a.user === 'jsmith' && a.groups.length > 0) && sendOk(x, 'pc1', 'www.example.com') },
      { title: 'adoe (Engineering) logs in on PC2 and is refused', how: 'Lab > Users: PC2, adoe / Eng123!. Then send PC2 → www.example.com. It must fail.', check: (x) => Object.values(x.rt.lab.auth).some((a) => a.user === 'adoe') && !sendOk(x, 'pc2', 'www.example.com') },
    ],
  },
  {
    id: 'l10-ipsec',
    title: 'Site-to-site IPsec VPN',
    level: 'Advanced',
    minutes: 30,
    topic: 'IPsec phase 1/2, routes, VPN policies',
    intro: 'Connect HQ to the branch office (Branch-FGT 198.51.100.200, LAN 10.20.0.0/24). The branch settings are fixed and shown in Lab > VPN: match them exactly.',
    build: starterConfig,
    startPage: 'vpn-wizard',
    tasks: [
      { title: 'A tunnel to the branch is Up', how: 'VPN > IPsec Wizard (or a custom tunnel). Check VPN > IPsec Tunnels: the Reason column explains failures.', check: (x) => Object.values(x.net.tunnels).some((t) => t.up) },
      { title: 'PC1 can ping Branch-PC (10.20.0.10)', how: 'Needs a route to 10.20.0.0/24 via the tunnel and a policy internal → tunnel (NAT off).', check: (x) => sendOk(x, 'pc1', '10.20.0.10', 'icmp', 0) },
      { title: 'Branch-PC can RDP to PC1', how: 'Needs the policy tunnel → internal.', check: (x) => sendOk(x, 'branchpc', '192.168.1.110', 'tcp', 3389) },
      { title: 'A blackhole route stops branch traffic leaking to the internet if the tunnel drops', how: 'Network > Static Routes: 10.20.0.0/24, Interface Blackhole, distance 254 (the wizard adds it for you).', check: (x) => x.net.routes.some((r) => r.blackhole && r.net === ipToInt('10.20.0.0') && r.prefix === 24) },
    ],
  },
  {
    id: 'l11-sslvpn',
    title: 'SSL-VPN for remote workers',
    level: 'Advanced',
    minutes: 25,
    topic: 'SSL-VPN settings, portals, ssl.root policy, split tunneling',
    intro: 'Remote staff need FortiClient access to the office PCs. Create a local user, a group, SSL-VPN settings on wan1 and the ssl.root policy, then connect Remote-Laptop.',
    build: starterConfig,
    startPage: 'vpn-sslsettings',
    tasks: [
      { title: 'SSL-VPN listens on wan1 on a port other than the admin HTTPS port', how: 'VPN > SSL-VPN Settings: Listen on wan1, port 10443.', check: (x) => { const o = x.c['vpn ssl settings']; const f = o?.kind === 'object' ? o.f : {}; return list(def('vpn ssl settings'), f, 'source-interface').includes('wan1') && str(def('vpn ssl settings'), f, 'port') !== gobj(x.c, 'system global', 'admin-sport'); } },
      { title: 'Remote-Laptop is connected with FortiClient', how: 'Create a user and group, an authentication rule (portal tunnel-access), a policy ssl.root → internal with the group, then Lab > VPN > Connect.', check: (x) => !!x.rt.lab.sslClients?.laptop },
      { title: 'Remote-Laptop can RDP to PC1 through the tunnel', how: 'Send Remote-Laptop → 192.168.1.110 TCP/3389.', check: (x) => sendOk(x, 'laptop', '192.168.1.110', 'tcp', 3389) },
    ],
  },
  {
    id: 'l12-sdwan',
    title: 'SD-WAN with two ISPs',
    level: 'Advanced',
    minutes: 30,
    topic: 'SD-WAN members, performance SLA, failover',
    intro: 'A second internet line (ISP2) is now plugged into wan2. Build SD-WAN so the office survives an ISP1 outage automatically.',
    build: starterConfig,
    lab: { wan2Cable: true },
    startPage: 'net-sdwan',
    tasks: [
      { title: 'SD-WAN is enabled with wan1 and wan2 as members', how: 'Network > SD-WAN > SD-WAN Zones: enable, add wan1 (gw 203.0.113.1) and wan2 (gw 198.18.10.1). FortiOS refuses while policies still use wan1 directly: first change policies 1 and 3 (Outgoing) and 2 (Incoming) to virtual-wan-link. Do that right after enabling SD-WAN with wan2 only, then add wan1.', check: (x) => x.net.sdwan.enabled && ['wan1', 'wan2'].every((i) => x.net.sdwan.members.some((m) => m.intf === i)) },
      { title: 'Policy 1 goes out the SD-WAN zone and a default route points to it', how: 'Edit policy 1: Outgoing interface virtual-wan-link. Static Routes: 0.0.0.0/0, Interface = SD-WAN zone virtual-wan-link.', check: (x) => policies(x.c).find((p) => p.id === '1')?.dstintf.includes('virtual-wan-link') === true && entries(x.c, 'router static').some((e) => list(def('router static'), e.f, 'sdwan-zone').length > 0) },
      { title: 'A Performance SLA probes an internet server (not the ISP gateway)', how: 'Performance SLAs > Create New: server 8.8.8.8, both members.', check: (x) => x.net.sdwan.health.some((h) => h.members.length >= 2 && !/203\.0\.113\.1|198\.18\.10\.1/.test(h.server)) },
      { title: 'With an ISP1 outage, PC1 still reaches 8.8.8.8', how: 'Lab > WAN: switch on "ISP1 outage", then ping 8.8.8.8 from PC1.', check: (x) => !!x.rt.lab.ispDown?.wan1 && sendOk(x, 'pc1', '8.8.8.8', 'icmp', 0) },
    ],
  },
  {
    id: 'l13-dynamic',
    title: 'Dynamic routing: OSPF over VPN and BGP',
    level: 'Advanced',
    minutes: 30,
    topic: 'OSPF neighbors, BGP peering, administrative distance',
    intro: 'The VPN to the branch is already up with a static route. Replace the static route with OSPF over the tunnel, and peer with your ISP using BGP (details on Network > BGP and OSPF).',
    build: () => vpnBase(starterConfig()),
    startPage: 'net-ospf',
    tasks: [
      { title: 'BGP session with the ISP is Established', how: 'Network > BGP: Local AS 65010, neighbor 203.0.113.1 remote AS 64500.', check: (x) => x.net.bgp.neighbors.some((n) => n.state === 'Established') },
      { title: 'OSPF neighbor 10.20.0.1 is Full', how: 'Give tunnel to-branch IP 169.254.1.1/32 with remote IP 169.254.1.2/30 (Network > Interfaces), then OSPF: area 0.0.0.0, network 169.254.1.0/30.', check: (x) => x.net.ospf.neighbors.some((n) => n.state === 'Full') },
      { title: '10.20.0.0/24 is now learned by OSPF (static route removed)', how: 'Delete the static route to 10.20.0.0/24 via the tunnel. Static (distance 10) beats OSPF (110), so the OSPF route only becomes active without it. Keep the blackhole.', check: (x) => routeActive(x, '10.20.0.0/24', 'ospf') },
      { title: 'PC1 still reaches Branch-PC', how: 'Ping 10.20.0.10 from PC1.', check: (x) => sendOk(x, 'pc1', '10.20.0.10', 'icmp', 0) },
    ],
  },

  // ---------- troubleshooting challenges ----------
  {
    id: 'c1-no-internet',
    title: 'Nobody can browse the internet',
    level: 'Challenge',
    minutes: 10,
    topic: 'Troubleshooting: NAT',
    intro: 'Users call: "the internet is down". The policy is there and the counters go up. Find the fault using the Packet Walk or "diagnose debug flow".',
    build: () => {
      const c = starterConfig();
      patchPolicy(c, '1', { nat: 'disable' });
      return c;
    },
    tasks: [{ title: 'PC1 can browse www.example.com', how: 'Reproduce from the Traffic Generator and read where it fails.', check: (x) => sendOk(x, 'pc1', 'www.example.com') }],
    hints: ['The request leaves the FortiGate. What source address does it have on the internet?', 'Look at the "Source NAT" step in the Packet Walk.', 'Private addresses (192.168.x.x) cannot receive replies from the internet.'],
    solution: ['Edit policy 1 (LAN-to-Internet).', 'Turn NAT on (Use Outgoing Interface Address).', 'OK, then test again.'],
  },
  {
    id: 'c2-dns',
    title: 'Pings work, websites do not',
    level: 'Challenge',
    minutes: 10,
    topic: 'Troubleshooting: DNS',
    intro: '"I can ping 8.8.8.8 but no website opens." Find out why.',
    build: () => {
      const c = starterConfig();
      patchPolicy(c, '1', { service: ['HTTP', 'HTTPS', 'PING'] });
      return c;
    },
    tasks: [{ title: 'PC1 can browse www.example.com', how: 'Compare pinging an IP with browsing a name.', check: (x) => sendOk(x, 'pc1', 'www.example.com') }],
    hints: ['Browsing by name needs something before the HTTPS connection.', 'Look at the [DNS] steps in the Packet Walk.', 'Which service does policy 1 allow?'],
    solution: ['Edit policy 1.', 'Add the service DNS (or use the group Web Access).', 'OK, then test again.'],
  },
  {
    id: 'c3-website',
    title: 'Our website is down',
    level: 'Challenge',
    minutes: 10,
    topic: 'Troubleshooting: VIP',
    intro: 'Customers cannot open http://203.0.113.10. The web server itself is fine.',
    build: () => {
      const c = starterConfig();
      const v = find(c, 'firewall vip', 'VIP-WebServer-HTTP')!;
      v.f.mappedip = ['10.10.10.11'];
      return c;
    },
    tasks: [{ title: 'Internet-User reaches http://203.0.113.10', how: 'Use quick test "Internet user visits your website".', check: (x) => sendOk(x, 'user', '203.0.113.10', 'tcp', 80) }],
    hints: ['Follow the packet after the Destination NAT step.', 'Which internal address does the VIP translate to?', 'The web server is 10.10.10.10.'],
    solution: ['Policy & Objects > Virtual IPs > VIP-WebServer-HTTP.', 'Map to IPv4 address: 10.10.10.10.', 'OK, then test again.'],
  },
  {
    id: 'c4-dhcp',
    title: 'PC2 has no network',
    level: 'Challenge',
    minutes: 10,
    topic: 'Troubleshooting: DHCP',
    intro: 'PC1 works, but PC2 has no internet at all after a reboot.',
    build: () => {
      const c = starterConfig();
      const srv = entries(c, 'system dhcp server').find((e) => e.f.interface === 'internal')!;
      const r = sub(srv.f, 'ip-range')!;
      r.entries[0].f['end-ip'] = '192.168.1.110';
      return c;
    },
    tasks: [{ title: 'PC2 has an address and can browse', how: 'Check PC2 in the Traffic Generator (its address is shown under Source).', check: (x) => hostIp(x, 'pc2').startsWith('192.168.1.') && sendOk(x, 'pc2', 'www.example.com') }],
    hints: ['What IP does PC2 have? 169.254.x.x means DHCP failed.', 'Dashboard > Network > DHCP shows the leases.', 'How many addresses does the DHCP range contain?'],
    solution: ['Network > Interfaces > edit internal.', 'DHCP Server address range: 192.168.1.110 - 192.168.1.210.', 'OK, then test again.'],
  },
  {
    id: 'c5-branch',
    title: 'The branch office is cut off',
    level: 'Challenge',
    minutes: 15,
    topic: 'Troubleshooting: IPsec',
    intro: 'Since a change last night, HQ and the branch cannot reach each other. Two things are wrong.',
    build: () => vpnBase(starterConfig(), 'Branch-PSK-2025', false),
    tasks: [
      { title: 'PC1 can ping Branch-PC', how: 'Start with VPN > IPsec Tunnels: is the tunnel up?', check: (x) => sendOk(x, 'pc1', '10.20.0.10', 'icmp', 0) },
      { title: 'Branch-PC can RDP to PC1', how: 'Test the reverse direction too.', check: (x) => sendOk(x, 'branchpc', '192.168.1.110', 'tcp', 3389) },
    ],
    hints: ['IPsec Tunnels shows a reason for the tunnel being down. In the CLI, try "diagnose debug application ike -1" and "diagnose debug enable".', 'Compare the pre-shared key with Lab > VPN.', 'Once the tunnel is up, check the routing table for 10.20.0.0/24.'],
    solution: ['Edit tunnel to-branch: pre-shared key Branch-PSK-2026.', 'Network > Static Routes > Create New: 10.20.0.0/24, Interface to-branch.', 'Test both directions.'],
  },
  {
    id: 'c6-failover',
    title: 'The backup line never takes over',
    level: 'Challenge',
    minutes: 15,
    topic: 'Troubleshooting: SD-WAN health checks',
    intro: 'SD-WAN is configured with two ISPs, yet during the current ISP1 outage the office is offline. Find out why SD-WAN keeps using wan1.',
    build: () => sdwanBase(starterConfig(), 'gateways'),
    lab: { wan2Cable: true, ispDown: { wan1: true } },
    startPage: 'net-sdwan',
    tasks: [{ title: 'During the ISP1 outage, PC1 reaches 8.8.8.8', how: 'Keep the outage on (Lab > WAN) while you fix it.', check: (x) => !!x.rt.lab.ispDown?.wan1 && sendOk(x, 'pc1', '8.8.8.8', 'icmp', 0) }],
    hints: ['Network > SD-WAN > Performance SLAs: is wan1 alive or dead?', 'What server is the health check probing? Is it beyond the ISP?', 'Also check which members the health check probes.'],
    solution: ['Performance SLAs: set the server to 8.8.8.8.', 'Make both wan1 and wan2 participants.', 'Apply, then test again.'],
  },
];

/** Evaluate every task of a lab against the current state. */
export function evaluateLab(lab: Lab, c: Config, rt: Runtime): boolean[] {
  const net = buildNet(c);
  const x: CheckCtx = { c, rt, net, send: (r) => runTraffic(c, rt, r).history[0] };
  return lab.tasks.map((t) => {
    try {
      return t.check(x);
    } catch {
      return false;
    }
  });
}

// "CLI was used" checks read the CLI history without importing the CLI module (avoids a cycle).
let cliHistory: () => string[] = () => [];
export const setCliHistorySource = (f: () => string[]) => {
  cliHistory = f;
};
function cliRan(re: RegExp) {
  return cliHistory().some((l) => re.test(l.trim()));
}
