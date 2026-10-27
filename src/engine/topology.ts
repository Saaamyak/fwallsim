// The fixed lab network wired to the simulated FortiGate.

export interface Listen {
  proto: 'tcp' | 'udp';
  port: number;
  app: string;
}

export interface Host {
  id: string;
  name: string;
  kind: 'pc' | 'server' | 'router' | 'internet' | 'attacker';
  /** FortiGate port the host is cabled to, or 'internet' */
  segment: string;
  addressing: 'dhcp' | 'static';
  ip?: string;
  prefix?: number;
  gw?: string;
  dns?: string;
  listen: Listen[];
  ping: boolean;
  country: string;
  desc: string;
  canSend: boolean;
}

const web: Listen[] = [
  { proto: 'tcp', port: 80, app: 'HTTP' },
  { proto: 'tcp', port: 443, app: 'HTTPS' },
];
const dns: Listen[] = [
  { proto: 'udp', port: 53, app: 'DNS' },
  { proto: 'tcp', port: 53, app: 'DNS' },
];

export interface IspInfo {
  name: string;
  host: string;
  ip: string;
  net: string;
  prefix: number;
  lease: string;
}

/** Internet providers, keyed by the FortiGate port they are cabled to. */
export const ISPS: Record<string, IspInfo> = {
  wan1: { name: 'ISP1', host: 'ISP-Router', ip: '203.0.113.1', net: '203.0.113.0', prefix: 24, lease: '203.0.113.10' },
  wan2: { name: 'ISP2', host: 'ISP2-Router', ip: '198.18.10.1', net: '198.18.10.0', prefix: 24, lease: '198.18.10.10' },
};
export const ISP = ISPS.wan1;

export const HOSTS: Host[] = [
  { id: 'pc1', name: 'PC1-Admin', kind: 'pc', segment: 'internal1', addressing: 'dhcp', listen: [{ proto: 'tcp', port: 3389, app: 'RDP' }], ping: true, country: 'Reserved', desc: 'Admin workstation on port internal1. Gets its IP from the FortiGate DHCP server.', canSend: true },
  { id: 'pc2', name: 'PC2-Sales', kind: 'pc', segment: 'internal2', addressing: 'dhcp', listen: [], ping: true, country: 'Reserved', desc: 'Sales laptop on port internal2. Gets its IP from the FortiGate DHCP server.', canSend: true },
  { id: 'web', name: 'Web-Server', kind: 'server', segment: 'dmz', addressing: 'static', ip: '10.10.10.10', prefix: 24, gw: '10.10.10.1', dns: '8.8.8.8', listen: [...web, { proto: 'tcp', port: 22, app: 'SSH' }], ping: true, country: 'Reserved', desc: 'Linux web server in the DMZ. Static IP 10.10.10.10/24, gateway 10.10.10.1.', canSend: true },
  { id: 'isp2', name: 'ISP2-Router', kind: 'router', segment: 'wan2', addressing: 'static', ip: '198.18.10.1', prefix: 24, listen: [], ping: true, country: 'Reserved', desc: 'Second internet provider. Plug wan2 into it from Lab > WAN. Hands out 198.18.10.10/24 by DHCP.', canSend: false },
  { id: 'dc', name: 'AD-Server', kind: 'server', segment: 'dmz', addressing: 'static', ip: '10.10.10.20', prefix: 24, gw: '10.10.10.1', dns: '127.0.0.1', listen: [{ proto: 'tcp', port: 389, app: 'LDAP' }, { proto: 'tcp', port: 636, app: 'LDAPS' }, { proto: 'udp', port: 1812, app: 'RADIUS' }, { proto: 'udp', port: 53, app: 'DNS' }, { proto: 'tcp', port: 88, app: 'KERBEROS' }], ping: true, country: 'Reserved', desc: 'Windows domain controller (lab.local) in the DMZ: LDAP 389/636 and RADIUS 1812. Directory details are in Lab > Users.', canSend: false },
  { id: 'nms', name: 'NMS-Server', kind: 'server', segment: 'dmz', addressing: 'static', ip: '10.10.10.30', prefix: 24, gw: '10.10.10.1', dns: '8.8.8.8', listen: [{ proto: 'udp', port: 514, app: 'SYSLOG' }, { proto: 'udp', port: 162, app: 'SNMP-TRAP' }], ping: true, country: 'Reserved', desc: 'Monitoring server in the DMZ: receives syslog (UDP/514) and polls the FortiGate with SNMP (Lab > Mgmt).', canSend: true },
  { id: 'isp', name: 'ISP-Router', kind: 'router', segment: 'wan1', addressing: 'static', ip: ISP.ip, prefix: 24, listen: [], ping: true, country: 'Reserved', desc: 'Your internet provider. Hands out 203.0.113.10/24 by DHCP on wan1 and routes 203.0.113.0/24 to you.', canSend: false },
  { id: 'fgdns1', name: 'FortiGuard-DNS', kind: 'internet', segment: 'internet', addressing: 'static', ip: '96.45.45.45', listen: dns, ping: true, country: 'United States', desc: 'Default system DNS server.', canSend: false },
  { id: 'fgdns2', name: 'FortiGuard-DNS-2', kind: 'internet', segment: 'internet', addressing: 'static', ip: '96.45.46.46', listen: dns, ping: true, country: 'United States', desc: 'Secondary system DNS server.', canSend: false },
  { id: 'gdns', name: 'Google-DNS', kind: 'internet', segment: 'internet', addressing: 'static', ip: '8.8.8.8', listen: [...dns, { proto: 'tcp', port: 443, app: 'HTTPS' }], ping: true, country: 'United States', desc: 'Public DNS resolver.', canSend: false },
  { id: 'cf', name: 'Cloudflare-DNS', kind: 'internet', segment: 'internet', addressing: 'static', ip: '1.1.1.1', listen: [...dns, { proto: 'tcp', port: 443, app: 'HTTPS' }], ping: true, country: 'Australia', desc: 'Public DNS resolver.', canSend: false },
  { id: 'example', name: 'www.example.com', kind: 'internet', segment: 'internet', addressing: 'static', ip: '93.184.216.34', listen: web, ping: true, country: 'United States', desc: 'Generic website.', canSend: false },
  { id: 'youtube', name: 'www.youtube.com', kind: 'internet', segment: 'internet', addressing: 'static', ip: '142.250.183.14', listen: web, ping: true, country: 'United States', desc: 'Video streaming site.', canSend: false },
  { id: 'facebook', name: 'www.facebook.com', kind: 'internet', segment: 'internet', addressing: 'static', ip: '157.240.1.35', listen: web, ping: false, country: 'Ireland', desc: 'Social media site (does not answer ping).', canSend: false },
  { id: 'ftp', name: 'ftp.example.org', kind: 'internet', segment: 'internet', addressing: 'static', ip: '198.51.100.21', listen: [{ proto: 'tcp', port: 21, app: 'FTP' }], ping: true, country: 'Germany', desc: 'Public FTP server.', canSend: false },
  { id: 'branchfw', name: 'Branch-FGT', kind: 'router', segment: 'internet', addressing: 'static', ip: '198.51.100.200', listen: [{ proto: 'udp', port: 500, app: 'IKE' }, { proto: 'udp', port: 4500, app: 'IKE NAT-T' }], ping: true, country: 'United States', desc: 'Branch office FortiGate. Its IPsec settings are fixed (Lab > VPN); configure HQ to match.', canSend: false },
  { id: 'branchpc', name: 'Branch-PC', kind: 'pc', segment: 'branch', addressing: 'static', ip: '10.20.0.10', prefix: 24, gw: '10.20.0.1', listen: [{ proto: 'tcp', port: 80, app: 'HTTP' }, { proto: 'tcp', port: 445, app: 'SMB' }, { proto: 'tcp', port: 3389, app: 'RDP' }], ping: true, country: 'Reserved', desc: 'A PC on the branch LAN 10.20.0.0/24, reachable only through the site-to-site VPN.', canSend: true },
  { id: 'laptop', name: 'Remote-Laptop', kind: 'pc', segment: 'internet', addressing: 'static', ip: '198.51.100.88', listen: [], ping: true, country: 'India', desc: 'An employee working from home with FortiClient (SSL-VPN). Connect it from Lab > VPN.', canSend: true },
  { id: 'user', name: 'Internet-User', kind: 'internet', segment: 'internet', addressing: 'static', ip: '198.51.100.77', listen: [], ping: true, country: 'Netherlands', desc: 'A customer on the internet. Use it to test inbound access (VIPs).', canSend: true },
  { id: 'attacker', name: 'Attacker', kind: 'attacker', segment: 'internet', addressing: 'static', ip: '192.0.2.66', listen: [], ping: true, country: 'Russian Federation', desc: 'Hostile host on the internet. Use it to test what your firewall blocks.', canSend: true },
];

export const DNS_TABLE: Record<string, string> = {
  'www.example.com': '93.184.216.34',
  'example.com': '93.184.216.34',
  'www.youtube.com': '142.250.183.14',
  'youtube.com': '142.250.183.14',
  'www.facebook.com': '157.240.1.35',
  'facebook.com': '157.240.1.35',
  'www.google.com': '142.250.183.4',
  'google.com': '142.250.183.4',
  'gmail.com': '142.250.183.5',
  'dns.google': '8.8.8.8',
  'one.one.one.one': '1.1.1.1',
  'ftp.example.org': '198.51.100.21',
  'login.microsoftonline.com': '20.190.160.1',
  'login.microsoft.com': '20.190.160.2',
  'login.windows.net': '20.190.160.3',
};

export const resolveName = (name: string): string | null => DNS_TABLE[name.toLowerCase().replace(/\.$/, '')] ?? null;

/** Any other public IP behaves like a generic web host. */
export const GENERIC_INTERNET: Pick<Host, 'listen' | 'ping' | 'country'> = { listen: web, ping: true, country: 'United States' };

/** The simulated Active Directory on AD-Server, used by LDAP/RADIUS authentication. */
export const DIRECTORY = {
  ip: '10.10.10.20',
  domain: 'lab.local',
  base: 'dc=lab,dc=local',
  usersDn: 'cn=Users,dc=lab,dc=local',
  bindDn: 'cn=fwbind,cn=Users,dc=lab,dc=local',
  bindPw: 'Bind123!',
  radiusSecret: 'Radius123!',
  users: [
    { user: 'jsmith', pw: 'Sales123!', name: 'John Smith', groups: ['CN=Sales,OU=Groups,DC=lab,DC=local'] },
    { user: 'adoe', pw: 'Eng123!', name: 'Anna Doe', groups: ['CN=Engineering,OU=Groups,DC=lab,DC=local'] },
    { user: 'itadmin', pw: 'ItAdmin123!', name: 'IT Admin', groups: ['CN=IT-Admins,OU=Groups,DC=lab,DC=local', 'CN=Engineering,OU=Groups,DC=lab,DC=local'] },
  ],
  groups: ['CN=Sales,OU=Groups,DC=lab,DC=local', 'CN=Engineering,OU=Groups,DC=lab,DC=local', 'CN=IT-Admins,OU=Groups,DC=lab,DC=local'],
};
