import type { Config, ConfigEntry, ConfigObject, ConfigTable, Fields } from './types';
import { newUuid, tableOf, objectOf } from './config';
import { hashAdminPasswords } from './admin';

const T = (entries: ConfigEntry[]): ConfigTable => ({ kind: 'table', entries });
const E = (key: string, f: Fields = {}): ConfigEntry => ({ key, f });
const O = (f: Fields = {}): ConfigObject => ({ kind: 'object', f });

const CATEGORIES = [
  'General',
  'Web Access',
  'File Access',
  'Email',
  'Network Services',
  'Authentication',
  'Remote Access',
  'Tunneling',
  'VoIP, Messaging & Other Applications',
  'Web Proxy',
];

// [name, category, tcp, udp, extra]
const SERVICES: [string, string, string[], string[], Fields?][] = [
  ['ALL', 'General', [], [], { protocol: 'IP' }],
  ['ALL_TCP', 'General', ['1-65535'], []],
  ['ALL_UDP', 'General', [], ['1-65535']],
  ['ALL_ICMP', 'General', [], [], { protocol: 'ICMP' }],
  ['GRE', 'Tunneling', [], [], { protocol: 'IP', 'protocol-number': '47' }],
  ['AH', 'Tunneling', [], [], { protocol: 'IP', 'protocol-number': '51' }],
  ['ESP', 'Tunneling', [], [], { protocol: 'IP', 'protocol-number': '50' }],
  ['HTTP', 'Web Access', ['80'], []],
  ['HTTPS', 'Web Access', ['443'], []],
  ['FTP', 'File Access', ['21'], []],
  ['TFTP', 'File Access', [], ['69']],
  ['SMB', 'File Access', ['445'], []],
  ['SAMBA', 'File Access', ['139'], []],
  ['NFS', 'File Access', ['111', '2049'], ['111', '2049']],
  ['DNS', 'Network Services', ['53'], ['53']],
  ['NTP', 'Network Services', ['123'], ['123']],
  ['DHCP', 'Network Services', [], ['67-68']],
  ['SNMP', 'Network Services', ['161-162'], ['161-162']],
  ['SYSLOG', 'Network Services', [], ['514']],
  ['PING', 'Network Services', [], [], { protocol: 'ICMP', icmptype: '8' }],
  ['TRACEROUTE', 'Network Services', [], ['33434-33535']],
  ['BGP', 'Network Services', ['179'], []],
  ['OSPF', 'Network Services', [], [], { protocol: 'IP', 'protocol-number': '89' }],
  ['MYSQL', 'Network Services', ['3306'], []],
  ['MS-SQL', 'Network Services', ['1433', '1434'], []],
  ['SSH', 'Remote Access', ['22'], []],
  ['TELNET', 'Remote Access', ['23'], []],
  ['RDP', 'Remote Access', ['3389'], []],
  ['VNC', 'Remote Access', ['5900'], []],
  ['SMTP', 'Email', ['25'], []],
  ['SMTPS', 'Email', ['465'], []],
  ['POP3', 'Email', ['110'], []],
  ['POP3S', 'Email', ['995'], []],
  ['IMAP', 'Email', ['143'], []],
  ['IMAPS', 'Email', ['993'], []],
  ['LDAP', 'Authentication', ['389'], []],
  ['LDAP_UDP', 'Authentication', [], ['389']],
  ['KERBEROS', 'Authentication', ['88'], ['88']],
  ['RADIUS', 'Authentication', [], ['1812', '1813']],
  ['IKE', 'Tunneling', [], ['500', '4500']],
  ['L2TP', 'Tunneling', ['1701'], ['1701']],
  ['PPTP', 'Tunneling', ['1723'], []],
  ['SIP', 'VoIP, Messaging & Other Applications', [], ['5060']],
];

export function factoryConfig(): Config {
  const internals = ['internal1', 'internal2', 'internal3', 'internal4', 'internal5'];
  return {
    'system global': O({ alias: 'FWS60F', hostname: 'FWS60F' }),
    'system accprofile': T([E('prof_admin', { ...{ secfabgrp: 'read-write', ftviewgrp: 'read-write', authgrp: 'read-write', sysgrp: 'read-write', netgrp: 'read-write', loggrp: 'read-write', fwgrp: 'read-write', vpngrp: 'read-write', utmgrp: 'read-write' }, sysgrp: 'read' }), E('super_admin', { secfabgrp: 'read-write', ftviewgrp: 'read-write', authgrp: 'read-write', sysgrp: 'read-write', netgrp: 'read-write', loggrp: 'read-write', fwgrp: 'read-write', vpngrp: 'read-write', utmgrp: 'read-write' })]),
    'system interface': T([
      E('dmz', { vdom: 'root', ip: '10.10.10.1 255.255.255.0', allowaccess: ['ping', 'https', 'fabric'], type: 'physical', role: 'dmz', 'snmp-index': '1' }),
      E('wan1', { vdom: 'root', mode: 'dhcp', allowaccess: ['ping', 'fgfm'], type: 'physical', role: 'wan', 'snmp-index': '2' }),
      E('wan2', { vdom: 'root', mode: 'dhcp', allowaccess: ['ping', 'fgfm'], type: 'physical', role: 'wan', 'snmp-index': '3' }),
      ...internals.map((p, i) => E(p, { vdom: 'root', type: 'physical', 'snmp-index': String(4 + i) })),
      E('internal', {
        vdom: 'root',
        ip: '192.168.1.99 255.255.255.0',
        allowaccess: ['ping', 'https', 'ssh', 'fabric'],
        type: 'hard-switch',
        role: 'lan',
        'snmp-index': '9',
      }),
      E('ssl.root', { vdom: 'root', type: 'tunnel', alias: 'SSL VPN interface', 'snmp-index': '10' }),
    ]),
    'system virtual-switch': T([E('internal', { 'physical-switch': 'sw0', port: T(internals.map((p) => E(p))) })]),
    'system zone': T([]),
    'system admin': T([E('admin', { accprofile: 'super_admin', vdom: ['root'] })]),
    'system settings': O(),
    'system dns': O(),
    'system dhcp server': T([
      E('1', {
        'dns-service': 'default',
        'default-gateway': '10.10.10.1',
        netmask: '255.255.255.0',
        interface: 'dmz',
        'ip-range': T([E('1', { 'start-ip': '10.10.10.2', 'end-ip': '10.10.10.254' })]),
      }),
      E('2', {
        'dns-service': 'default',
        'default-gateway': '192.168.1.99',
        netmask: '255.255.255.0',
        interface: 'internal',
        'ip-range': T([E('1', { 'start-ip': '192.168.1.110', 'end-ip': '192.168.1.210' })]),
      }),
    ]),
    'firewall address': T([
      E('none', { uuid: newUuid(), subnet: '0.0.0.0 255.255.255.255' }),
      E('all', { uuid: newUuid() }),
      E('FIREWALL_AUTH_PORTAL_ADDRESS', { uuid: newUuid() }),
      E('FABRIC_DEVICE', { uuid: newUuid(), comment: 'IPv4 addresses of Fabric Devices.' }),
      E('SSLVPN_TUNNEL_ADDR1', { uuid: newUuid(), type: 'iprange', 'start-ip': '10.212.134.200', 'end-ip': '10.212.134.210' }),
      E('login.microsoftonline.com', { uuid: newUuid(), type: 'fqdn', fqdn: 'login.microsoftonline.com' }),
      E('login.microsoft.com', { uuid: newUuid(), type: 'fqdn', fqdn: 'login.microsoft.com' }),
      E('login.windows.net', { uuid: newUuid(), type: 'fqdn', fqdn: 'login.windows.net' }),
      E('gmail.com', { uuid: newUuid(), type: 'fqdn', fqdn: 'gmail.com' }),
      E('wildcard.google.com', { uuid: newUuid(), type: 'fqdn', fqdn: '*.google.com' }),
      E('wildcard.dropbox.com', { uuid: newUuid(), type: 'fqdn', fqdn: '*.dropbox.com' }),
    ]),
    'firewall addrgrp': T([
      E('G Suite', { uuid: newUuid(), member: ['gmail.com', 'wildcard.google.com'] }),
      E('Microsoft Office 365', { uuid: newUuid(), member: ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net'] }),
    ]),
    'firewall service category': T(CATEGORIES.map((c) => E(c))),
    'firewall service custom': T(
      SERVICES.map(([name, category, tcp, udp, extra]) => {
        const f: Fields = { category, ...(extra ?? {}) };
        if (tcp.length) f['tcp-portrange'] = tcp;
        if (udp.length) f['udp-portrange'] = udp;
        return E(name, f);
      }),
    ),
    'firewall service group': T([
      E('Email Access', { member: ['DNS', 'IMAP', 'IMAPS', 'POP3', 'POP3S', 'SMTP', 'SMTPS'] }),
      E('Web Access', { member: ['DNS', 'HTTP', 'HTTPS'] }),
      E('Windows AD', { member: ['DNS', 'KERBEROS', 'LDAP', 'LDAP_UDP', 'SAMBA', 'SMB'] }),
    ]),
    'firewall schedule recurring': T([
      E('always', { day: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] }),
      E('none', { day: ['none'] }),
    ]),
    'firewall schedule onetime': T([]),
    'firewall schedule group': T([]),
    'firewall ippool': T([]),
    'firewall vip': T([]),
    'firewall vipgrp': T([]),
    'firewall ssl-ssh-profile': T([
      E('certificate-inspection', { comment: 'Read-only SSL handshake inspection profile.' }),
      E('deep-inspection', { comment: 'Read-only deep inspection profile.' }),
      E('no-inspection', { comment: 'Read-only profile that does no inspection.' }),
      E('custom-deep-inspection', { comment: 'Customizable deep inspection profile.' }),
    ]),
    'firewall policy': T([]),
    'router static': T([]),
    'log setting': O(),
    ...vpnDefaults(),
  };
}

/** Factory SSL-VPN portals and settings (SSL-VPN is not listening anywhere until configured). */
export function vpnDefaults(): Config {
  return {
    'vpn ipsec phase1-interface': T([]),
    'vpn ipsec phase2-interface': T([]),
    'vpn ssl web portal': T([
      E('full-access', { 'tunnel-mode': 'enable', 'web-mode': 'enable', 'ip-pools': ['SSLVPN_TUNNEL_ADDR1'], 'split-tunneling': 'enable' }),
      E('tunnel-access', { 'tunnel-mode': 'enable', 'ip-pools': ['SSLVPN_TUNNEL_ADDR1'], 'split-tunneling': 'enable' }),
      E('web-access', { 'web-mode': 'enable' }),
    ]),
    'vpn ssl settings': O({ servercert: 'Fortinet_Factory', 'tunnel-ip-pools': ['SSLVPN_TUNNEL_ADDR1'], port: '443' }),
    'user setting': O(),
    'user ldap': T([]),
    'user radius': T([]),
    'user local': T([]),
    'user group': T([E('Guest-group', { member: [] })]),
  };
}

/** Bring a config saved by an older FWallSim version up to date. */
export function migrateConfig(c: Config): Config {
  for (const [k, v] of Object.entries(vpnDefaults())) if (!c[k]) c[k] = v;
  // Older saves have access profiles without permissions.
  const ap = c['system accprofile'];
  if (ap?.kind === 'table') for (const e of ap.entries) if (Object.keys(e.f).length === 0 && (e.key === 'super_admin' || e.key === 'prof_admin')) Object.assign(e.f, { secfabgrp: 'read-write', ftviewgrp: 'read-write', authgrp: 'read-write', sysgrp: 'read-write', netgrp: 'read-write', loggrp: 'read-write', fwgrp: 'read-write', vpngrp: 'read-write', utmgrp: 'read-write' }, e.key === 'prof_admin' ? { sysgrp: 'read' } : {});
  // Early builds used "FWallSim" as the default hostname, which duplicated the product name in the header.
  const g = c['system global'];
  if (g?.kind === 'object' && g.f.hostname === 'FWallSim') g.f.hostname = 'FWS60F';
  // Up to v1.0.0 admin passwords were kept in plain text.
  hashAdminPasswords(c);
  return c;
}

/** A small office: LAN out to the internet, a published DMZ web server. */
export function starterConfig(): Config {
  const c = factoryConfig();
  tableOf(c, 'firewall address').entries.push(E('WebServer-DMZ', { uuid: newUuid(), subnet: '10.10.10.10 255.255.255.255', comment: 'Company web server' }));
  tableOf(c, 'firewall address').entries.push(E('LAN-Subnet', { uuid: newUuid(), subnet: '192.168.1.0 255.255.255.0' }));
  tableOf(c, 'firewall vip').entries.push(
    E('VIP-WebServer-HTTP', {
      uuid: newUuid(),
      extintf: 'wan1',
      extip: ['203.0.113.10'],
      mappedip: ['10.10.10.10'],
      portforward: 'enable',
      extport: ['80'],
      mappedport: ['80'],
      comment: 'Publish web server to the internet',
    }),
  );
  const pol = (id: string, f: Fields) => E(id, { uuid: newUuid(), schedule: 'always', ...f });
  tableOf(c, 'firewall policy').entries.push(
    pol('1', {
      name: 'LAN-to-Internet',
      srcintf: ['internal'],
      dstintf: ['wan1'],
      action: 'accept',
      srcaddr: ['LAN-Subnet'],
      dstaddr: ['all'],
      service: ['ALL'],
      nat: 'enable',
      logtraffic: 'all',
    }),
    pol('2', {
      name: 'Web-Server-Inbound',
      srcintf: ['wan1'],
      dstintf: ['dmz'],
      action: 'accept',
      srcaddr: ['all'],
      dstaddr: ['VIP-WebServer-HTTP'],
      service: ['HTTP'],
      logtraffic: 'all',
    }),
    pol('3', {
      name: 'DMZ-to-Internet',
      srcintf: ['dmz'],
      dstintf: ['wan1'],
      action: 'accept',
      srcaddr: ['WebServer-DMZ'],
      dstaddr: ['all'],
      service: ['DNS', 'HTTP', 'HTTPS'],
      nat: 'enable',
      logtraffic: 'all',
    }),
  );
  objectOf(c, 'log setting').f['fwpolicy-implicit-log'] = 'enable';
  return c;
}

export const SCENARIOS = [
  { id: 'factory', name: 'Factory default', desc: 'Fresh unit: no firewall policies, only the implicit deny. Everything through the firewall is blocked.', build: factoryConfig },
  { id: 'starter', name: 'Small office (starter)', desc: 'LAN to internet with NAT, a DMZ web server published with a VIP, and implicit-deny logging on.', build: starterConfig },
];
