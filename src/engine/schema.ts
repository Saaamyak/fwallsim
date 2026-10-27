// FortiOS-style schema: which config paths exist, their fields, types and defaults.
// The serializer uses it for quoting/"show full-configuration", the GUI and engine for defaults,
// and the CLI (Phase 3) will use it for validation and tab completion.

export type FieldType =
  | 'string' // quoted free text
  | 'int'
  | 'option' // one of options, unquoted
  | 'options' // several of options, unquoted (e.g. allowaccess)
  | 'ref' // one object name, quoted
  | 'refs' // several object names, quoted
  | 'ipmask'
  | 'ip'
  | 'words' // several unquoted words (e.g. tcp-portrange)
  | 'strings' // several quoted strings (e.g. mappedip)
  | 'table' // nested "config ... edit ... next ... end"
  | 'object' // nested "config ... end" block without edit
  | 'password'
  | 'uuid'
  | 'time'
  | 'datetime';

export interface FieldDef {
  name: string;
  type: FieldType;
  default?: string | string[];
  options?: string[];
  ref?: string[];
  help?: string;
  sub?: PathDef;
}

export interface PathDef {
  path: string;
  kind: 'table' | 'object';
  key?: 'int' | 'string';
  fields: FieldDef[];
  help?: string;
}

const f = (name: string, type: FieldType, dflt?: string | string[], extra: Partial<FieldDef> = {}): FieldDef => ({
  name,
  type,
  default: dflt,
  ...extra,
});
const str = (n: string, d = '', help?: string) => f(n, 'string', d, { help });
const int = (n: string, d = '0', help?: string) => f(n, 'int', d, { help });
const opt = (n: string, options: string[], d: string, help?: string) => f(n, 'option', d, { options, help });
const en = (n: string, d: 'enable' | 'disable' = 'disable', help?: string) => opt(n, ['enable', 'disable'], d, help);
const opts = (n: string, options: string[], d: string[] = [], help?: string) => f(n, 'options', d, { options, help });
const ref = (n: string, r: string[], d = '', help?: string) => f(n, 'ref', d, { ref: r, help });
const refs = (n: string, r: string[], help?: string) => f(n, 'refs', [], { ref: r, help });
const ipmask = (n: string, d = '0.0.0.0 0.0.0.0', help?: string) => f(n, 'ipmask', d, { help });
const ip = (n: string, d = '0.0.0.0', help?: string) => f(n, 'ip', d, { help });
const words = (n: string, help?: string) => f(n, 'words', [], { help });
const strs = (n: string, help?: string) => f(n, 'strings', [], { help });
const uuid = () => f('uuid', 'uuid', '');
const table = (n: string, sub: PathDef, help?: string) => f(n, 'table', undefined, { sub, help });
const obj = (n: string, fields: FieldDef[], help?: string) => f(n, 'object', undefined, { sub: { path: n, kind: 'object', fields }, help });
const subTable = (n: string, fields: FieldDef[], help?: string) => table(n, { path: n, kind: 'table', key: 'int', fields }, help);
const avProto = (n: string) => obj(n, [opt('av-scan', ['disable', 'block', 'monitor'], 'disable', 'Enable AntiVirus scan service.')], `Configure ${n.toUpperCase()} AntiVirus options.`);

export const IF_REFS = ['system interface', 'system zone'];
export const ADDR_REFS = ['firewall address', 'firewall addrgrp'];
export const DSTADDR_REFS = ['firewall address', 'firewall addrgrp', 'firewall vip', 'firewall vipgrp'];
export const SVC_REFS = ['firewall service custom', 'firewall service group'];
export const SCHED_REFS = ['firewall schedule recurring', 'firewall schedule onetime', 'firewall schedule group'];

export const ALLOWACCESS = ['ping', 'https', 'ssh', 'snmp', 'http', 'telnet', 'fgfm', 'radius-acct', 'probe-response', 'fabric', 'ftm', 'speed-test'];
export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const SCHEMA: PathDef[] = [
  {
    path: 'system global',
    kind: 'object',
    help: 'Configure global attributes.',
    fields: [
      str('alias', 'FWS60F', 'Alias for your FortiGate unit.'),
      str('hostname', 'FWS60F', 'FortiGate unit\'s hostname.'),
      str('timezone', 'Asia/Kolkata', 'Timezone database name.'),
      int('admintimeout', '5', 'Number of minutes before an idle administrator session times out (1 - 480).'),
      int('admin-sport', '443', 'Administrative access port for HTTPS.'),
      int('admin-port', '80', 'Administrative access port for HTTP.'),
      int('admin-ssh-port', '22', 'Administrative access port for SSH.'),
      int('admin-telnet-port', '23', 'Administrative access port for TELNET.'),
      en('admin-https-redirect', 'enable', 'Enable/disable redirection of HTTP administration access to HTTPS.'),
      opt('gui-theme', ['jade', 'neutrino', 'mariner', 'graphite', 'dark-matter'], 'jade', 'Color scheme for the administration GUI.'),
      opt('language', ['english'], 'english', 'GUI display language.'),
      en('post-login-banner', 'disable', 'Enable/disable displaying the administrator access disclaimer message after an administrator logs in.'),
      int('admin-lockout-threshold', '3', 'Number of failed login attempts before an administrator account is locked out for the admin-lockout-duration.'),
      int('admin-lockout-duration', '60', 'Amount of time in seconds that an administrator account is locked out after reaching the admin-lockout-threshold for repeated failed login attempts.'),
    ],
  },
  {
    path: 'system accprofile',
    kind: 'table',
    key: 'string',
    help: 'Configure access profiles for system administrators.',
    fields: [
      str('comments'),
      ...(['secfabgrp', 'ftviewgrp', 'authgrp', 'sysgrp', 'netgrp', 'loggrp', 'fwgrp', 'vpngrp', 'utmgrp'] as const).map((g) => opt(g, ['none', 'read', 'read-write'], 'none', `Administrator access to ${g.replace('grp', '')} features.`)),
    ],
  },
  {
    path: 'system interface',
    kind: 'table',
    key: 'string',
    help: 'Configure interfaces.',
    fields: [
      ref('vdom', ['system vdom'], 'root', 'Interface is in this virtual domain (VDOM).'),
      opt('mode', ['static', 'dhcp', 'pppoe'], 'static', 'Addressing mode (static, DHCP, PPPoE).'),
      ipmask('ip', '0.0.0.0 0.0.0.0', 'Interface IPv4 address and subnet mask, syntax: X.X.X.X/24.'),
      opts('allowaccess', ALLOWACCESS, [], 'Permitted types of management access to this interface.'),
      opt('status', ['up', 'down'], 'up', 'Bring the interface up or shut the interface down.'),
      opt('type', ['physical', 'vlan', 'hard-switch', 'tunnel', 'loopback', 'aggregate'], 'physical', 'Interface type.'),
      opt('role', ['lan', 'wan', 'dmz', 'undefined'], 'undefined', 'Interface role.'),
      str('alias', '', 'Alias will be displayed with the interface name to make it easier to distinguish.'),
      str('description', '', 'Description.'),
      ref('interface', ['system interface'], '', 'Interface name (parent of a VLAN).'),
      int('vlanid', '0', 'VLAN ID (1 - 4094).'),
      ipmask('remote-ip', '0.0.0.0 0.0.0.0', 'Remote IP address of tunnel.'),
      en('defaultgw', 'enable', 'Enable to get the gateway IP from the DHCP or PPPoE server.'),
      int('distance', '5', 'Distance for routes learned through PPPoE or DHCP, lower distance indicates preferred route.'),
      int('priority', '1', 'Priority of learned routes.'),
      en('dns-server-override', 'enable', 'Enable/disable use DNS acquired by DHCP or PPPoE.'),
      en('device-identification', 'disable', 'Enable/disable passively gathering of device identity information about the devices on the network connected to this interface.'),
      int('mtu', '1500', 'MTU value for this interface.'),
      int('snmp-index', '0', 'Permanent SNMP Index of the interface.'),
    ],
  },
  {
    path: 'system virtual-switch',
    kind: 'table',
    key: 'string',
    help: 'Configure virtual hardware switch interfaces.',
    fields: [
      str('physical-switch', 'sw0', 'Physical switch parent.'),
      table('port', { path: 'port', kind: 'table', key: 'string', fields: [str('alias')] }, 'Configure member ports.'),
    ],
  },
  {
    path: 'system zone',
    kind: 'table',
    key: 'string',
    help: 'Configure zones to group two or more interfaces. When a zone is created you can configure policies for the zone instead of individual interfaces in the zone.',
    fields: [
      opt('intrazone', ['allow', 'deny'], 'deny', 'Allow or deny traffic routing between different interfaces in the same zone.'),
      refs('interface', ['system interface'], 'Add interfaces to this zone.'),
      str('description'),
    ],
  },
  {
    path: 'system admin',
    kind: 'table',
    key: 'string',
    help: 'Configure admin users.',
    fields: [
      ref('accprofile', ['system accprofile'], '', 'Access profile for this administrator.'),
      refs('vdom', ['system vdom']),
      f('password', 'password', '', { help: 'Admin user password.' }),
      ipmask('trusthost1', '0.0.0.0 0.0.0.0', 'Any IPv4 address or subnet address and netmask from which the administrator can connect to the FortiGate unit.'),
      ipmask('trusthost2', '0.0.0.0 0.0.0.0', 'Any IPv4 address or subnet address and netmask from which the administrator can connect to the FortiGate unit.'),
      ipmask('trusthost3', '0.0.0.0 0.0.0.0', 'Any IPv4 address or subnet address and netmask from which the administrator can connect to the FortiGate unit.'),
      str('comments', '', 'Comment.'),
    ],
  },
  {
    path: 'system settings',
    kind: 'object',
    help: 'Configure VDOM settings.',
    fields: [
      opt('opmode', ['nat', 'transparent'], 'nat', 'Firewall operation mode (NAT or Transparent).'),
      en('central-nat', 'disable', 'Enable/disable central NAT.'),
      en('strict-src-check', 'disable', 'Enable to drop packets with source IP addresses that do not match the route to the incoming interface (strict RPF).'),
      en('asymroute', 'disable', 'Enable/disable IPv4 asymmetric routing.'),
      en('allow-subnet-overlap', 'disable', 'Enable/disable allowing interface subnets to use overlapping IP addresses.'),
    ],
  },
  {
    path: 'system dns',
    kind: 'object',
    help: 'Configure DNS.',
    fields: [
      ip('primary', '96.45.45.45', 'Primary DNS server IP address.'),
      ip('secondary', '96.45.46.46', 'Secondary DNS server IP address.'),
      opt('protocol', ['cleartext', 'dot', 'doh'], 'cleartext', 'DNS transport protocols.'),
      strs('domain', 'Search suffix list for hostname lookup.'),
    ],
  },
  {
    path: 'system dhcp server',
    kind: 'table',
    key: 'int',
    help: 'Configure DHCP servers.',
    fields: [
      en('status', 'enable', 'Enable/disable this DHCP configuration.'),
      int('lease-time', '604800', 'Lease time in seconds, 0 means unlimited.'),
      opt('dns-service', ['local', 'default', 'specify'], 'specify', 'Options for assigning DNS servers to DHCP clients.'),
      ip('dns-server1', '0.0.0.0', 'DNS server 1.'),
      ip('dns-server2', '0.0.0.0', 'DNS server 2.'),
      ip('default-gateway', '0.0.0.0', 'Default gateway IP address assigned by the DHCP server.'),
      ip('netmask', '0.0.0.0', 'Netmask assigned by the DHCP server.'),
      ref('interface', ['system interface'], '', 'DHCP server can assign IP configurations to clients connected to this interface.'),
      table(
        'ip-range',
        { path: 'ip-range', kind: 'table', key: 'int', fields: [ip('start-ip'), ip('end-ip')] },
        'DHCP IP range configuration.',
      ),
    ],
  },
  {
    path: 'user setting',
    kind: 'object',
    help: 'Configure user authentication setting.',
    fields: [
      opts('auth-type', ['http', 'https', 'ftp', 'telnet'], ['http', 'https', 'ftp', 'telnet'], 'Supported firewall policy authentication protocols/methods.'),
      int('auth-timeout', '5', 'Time in minutes before the firewall user authentication timeout requires the user to re-authenticate.'),
      opt('auth-timeout-type', ['idle-timeout', 'hard-timeout', 'new-session'], 'idle-timeout', 'Control if authenticated users have to login again after a hard timeout, after an idle timeout, or after a session timeout.'),
      int('auth-port', '1000', 'User authentication port for HTTP (1 - 65535).'),
      int('auth-port-https', '1003', 'User authentication port for HTTPS (1 - 65535).'),
    ],
  },
  {
    path: 'user ldap',
    kind: 'table',
    key: 'string',
    help: 'Configure LDAP server entries.',
    fields: [
      str('server', '', 'LDAP server CN domain name or IP.'),
      str('cnid', 'cn', 'Common name identifier for the LDAP server. The common name identifier for most LDAP servers is "cn".'),
      str('dn', '', 'Distinguished name used to look up entries on the LDAP server.'),
      opt('type', ['simple', 'anonymous', 'regular'], 'simple', 'Authentication type for LDAP searches.'),
      str('username', '', 'Username (full DN) for initial binding.'),
      f('password', 'password', '', { help: 'Password for initial binding.' }),
      opt('secure', ['disable', 'starttls', 'ldaps'], 'disable', 'Port to be used for authentication.'),
      int('port', '389', 'Port to be used for communication with the LDAP server (default = 389).'),
      opt('group-member-check', ['user-attr', 'group-object', 'posix-group-object'], 'user-attr', 'Group member checking methods.'),
    ],
  },
  {
    path: 'user radius',
    kind: 'table',
    key: 'string',
    help: 'Configure RADIUS server entries.',
    fields: [
      str('server', '', 'Primary RADIUS server CN domain name or IP address.'),
      f('secret', 'password', '', { help: 'Pre-shared secret key used to access the primary RADIUS server.' }),
      opt('auth-type', ['auto', 'ms_chap_v2', 'ms_chap', 'chap', 'pap'], 'auto', 'Authentication methods/protocols permitted for this RADIUS server.'),
      int('radius-port', '0', 'RADIUS service port number (0 = default 1812).'),
    ],
  },
  {
    path: 'user local',
    kind: 'table',
    key: 'string',
    help: 'Configure local users.',
    fields: [
      en('status', 'enable', 'Enable/disable allowing the local user to authenticate with the FortiGate unit.'),
      opt('type', ['password', 'ldap', 'radius'], 'password', 'Authentication method.'),
      f('passwd', 'password', '', { help: "User's password." }),
      ref('ldap-server', ['user ldap'], '', 'Name of LDAP server with which the user must authenticate.'),
      ref('radius-server', ['user radius'], '', 'Name of RADIUS server with which the user must authenticate.'),
      opt('two-factor', ['disable', 'fortitoken', 'email', 'sms'], 'disable', 'Enable/disable two-factor authentication.'),
      str('email-to', '', 'Two-factor recipient email address.'),
    ],
  },
  {
    path: 'user group',
    kind: 'table',
    key: 'string',
    help: 'Configure user groups.',
    fields: [
      opt('group-type', ['firewall', 'fsso-service', 'rsso', 'guest'], 'firewall', 'Set the group to be for firewall authentication, FSSO, RSSO, or guest users.'),
      refs('member', ['user local', 'user ldap', 'user radius'], 'Names of users, peers, LDAP severs, RADIUS servers or external idp servers to add to the user group.'),
      table('match', { path: 'match', kind: 'table', key: 'int', fields: [ref('server-name', ['user ldap', 'user radius'], '', 'Name of remote auth server.'), str('group-name', '', 'Name of matching user or group on remote authentication server.')] }, 'Group matches.'),
    ],
  },
  {
    path: 'firewall address',
    kind: 'table',
    key: 'string',
    help: 'Configure IPv4 addresses.',
    fields: [
      uuid(),
      opt('type', ['ipmask', 'iprange', 'fqdn', 'geography', 'wildcard', 'interface-subnet'], 'ipmask', 'Type of address.'),
      ipmask('subnet', '0.0.0.0 0.0.0.0', 'IP address and subnet mask of address.'),
      ip('start-ip', '0.0.0.0', 'First IP address (inclusive) in the range for the address.'),
      ip('end-ip', '0.0.0.0', 'Final IP address (inclusive) in the range for the address.'),
      str('fqdn', '', 'Fully Qualified Domain Name address.'),
      str('country', '', 'IP addresses associated to a specific country.'),
      ref('associated-interface', IF_REFS, '', 'Network interface associated with address.'),
      en('allow-routing', 'disable', 'Enable/disable use of this address in routing configurations.'),
      str('comment'),
      int('color', '0', 'Color of icon on the GUI.'),
    ],
  },
  {
    path: 'firewall addrgrp',
    kind: 'table',
    key: 'string',
    help: 'Configure IPv4 address groups.',
    fields: [uuid(), refs('member', ADDR_REFS, 'Address objects contained within the group.'), str('comment'), int('color', '0')],
  },
  {
    path: 'firewall service category',
    kind: 'table',
    key: 'string',
    help: 'Configure service categories.',
    fields: [str('comment')],
  },
  {
    path: 'firewall service custom',
    kind: 'table',
    key: 'string',
    help: 'Configure custom services.',
    fields: [
      ref('category', ['firewall service category'], '', 'Service category.'),
      opt('protocol', ['TCP/UDP/SCTP', 'ICMP', 'ICMP6', 'IP'], 'TCP/UDP/SCTP', 'Protocol type based on IANA numbers.'),
      words('tcp-portrange', 'Multiple TCP port ranges.'),
      words('udp-portrange', 'Multiple UDP port ranges.'),
      words('sctp-portrange', 'Multiple SCTP port ranges.'),
      f('icmptype', 'int', '', { help: 'ICMP type.' }),
      f('icmpcode', 'int', '', { help: 'ICMP code.' }),
      int('protocol-number', '0', 'IP protocol number.'),
      str('comment'),
      int('color', '0'),
    ],
  },
  {
    path: 'firewall service group',
    kind: 'table',
    key: 'string',
    help: 'Configure service groups.',
    fields: [refs('member', SVC_REFS, 'Service objects contained within the group.'), str('comment'), int('color', '0')],
  },
  {
    path: 'firewall schedule recurring',
    kind: 'table',
    key: 'string',
    help: 'Recurring schedule configuration.',
    fields: [
      f('start', 'time', '00:00', { help: 'Time of day to start the schedule, format hh:mm.' }),
      f('end', 'time', '00:00', { help: 'Time of day to end the schedule, format hh:mm.' }),
      opts('day', [...DAYS, 'none'], [], 'One or more days of the week on which the schedule is valid.'),
      int('color', '0'),
    ],
  },
  {
    path: 'firewall schedule onetime',
    kind: 'table',
    key: 'string',
    help: 'Onetime schedule configuration.',
    fields: [
      f('start', 'datetime', '00:00 2001/01/01', { help: 'Schedule start date and time, format hh:mm yyyy/mm/dd.' }),
      f('end', 'datetime', '00:00 2001/01/01', { help: 'Schedule end date and time, format hh:mm yyyy/mm/dd.' }),
      int('expiration-days', '3'),
      int('color', '0'),
    ],
  },
  {
    path: 'firewall schedule group',
    kind: 'table',
    key: 'string',
    help: 'Schedule group configuration.',
    fields: [refs('member', ['firewall schedule recurring', 'firewall schedule onetime']), int('color', '0')],
  },
  {
    path: 'firewall ippool',
    kind: 'table',
    key: 'string',
    help: 'Configure IPv4 IP pools.',
    fields: [
      opt('type', ['overload', 'one-to-one', 'fixed-port-range', 'port-block-allocation'], 'overload', 'IP pool type.'),
      ip('startip', '0.0.0.0', 'First IPv4 address (inclusive) in the range for the address pool.'),
      ip('endip', '0.0.0.0', 'Final IPv4 address (inclusive) in the range for the address pool.'),
      ip('source-startip', '0.0.0.0', 'First IPv4 address (inclusive) in the range of the source addresses to be translated.'),
      ip('source-endip', '0.0.0.0', 'Final IPv4 address (inclusive) in the range of the source addresses to be translated.'),
      en('arp-reply', 'enable', 'Enable/disable replying to ARP requests when an IP Pool is added to a policy.'),
      str('comments'),
    ],
  },
  {
    path: 'firewall vip',
    kind: 'table',
    key: 'string',
    help: 'Configure virtual IP for IPv4.',
    fields: [
      uuid(),
      str('comment'),
      opt('type', ['static-nat', 'load-balance', 'dns-translation', 'fqdn'], 'static-nat', 'Configure a static NAT or server load balance VIP.'),
      f('extip', 'words', [], { help: 'IP address or address range on the external interface that you want to map to an address or address range on the destination network.' }),
      strs('mappedip', 'IP address or address range on the destination network to which the external IP address is mapped.'),
      ref('extintf', IF_REFS, 'any', 'Interface connected to the source network that receives the packets that will be forwarded to the destination network.'),
      en('arp-reply', 'enable', 'Enable to respond to ARP requests for this virtual IP address.'),
      en('portforward', 'disable', 'Enable/disable port forwarding.'),
      opt('protocol', ['tcp', 'udp', 'sctp', 'icmp'], 'tcp', 'Protocol to use when forwarding packets.'),
      f('extport', 'words', [], { help: 'Incoming port number range that you want to map to a port number range on the destination network.' }),
      f('mappedport', 'words', [], { help: 'Port number range on the destination network to which the external port number range is mapped.' }),
      int('color', '0'),
    ],
  },
  {
    path: 'firewall vipgrp',
    kind: 'table',
    key: 'string',
    help: 'Configure IPv4 virtual IP groups.',
    fields: [uuid(), ref('interface', IF_REFS, '', 'Interface.'), refs('member', ['firewall vip']), str('comments'), int('color', '0')],
  },
  {
    path: 'firewall ssl-ssh-profile',
    kind: 'table',
    key: 'string',
    help: 'Configure SSL/SSH protocol options.',
    fields: [
      str('comment'),
      obj('https', [words('ports', 'Ports to use for scanning (1 - 65535, default = 443).'), opt('status', ['disable', 'certificate-inspection', 'deep-inspection'], 'deep-inspection', 'Configure protocol inspection status.')], 'Configure HTTPS options.'),
      str('caname', 'Fortinet_CA_SSL', 'CA certificate used by SSL Inspection.'),
      opt('server-cert-mode', ['re-sign', 'replace'], 're-sign', 'Re-sign or replace the server certificate.'),
      subTable('ssl-exempt', [opt('type', ['fortiguard-category', 'address'], 'fortiguard-category', 'Type of address object.'), int('fortiguard-category', '0', 'FortiGuard category ID.'), ref('address', ADDR_REFS, '', 'IPv4 address object.')], 'Servers to exempt from SSL inspection.'),
    ],
  },
  {
    path: 'antivirus profile',
    kind: 'table',
    key: 'string',
    help: 'Configure AntiVirus profiles.',
    fields: [str('comment'), opt('feature-set', ['flow', 'proxy'], 'flow', 'Flow/proxy feature set.'), avProto('http'), avProto('ftp'), avProto('imap'), avProto('pop3'), avProto('smtp')],
  },
  {
    path: 'webfilter urlfilter',
    kind: 'table',
    key: 'int',
    help: 'Configure URL filter lists.',
    fields: [
      str('name', '', 'Name of URL filter list.'),
      str('comment'),
      subTable('entries', [
        str('url', '', 'URL to be filtered.'),
        opt('type', ['simple', 'regex', 'wildcard'], 'simple', 'Filter type (simple, regex, or wildcard).'),
        opt('action', ['exempt', 'block', 'allow', 'monitor'], 'exempt', 'Action to take for URL filter matches.'),
        en('status', 'enable', 'Enable/disable this URL filter.'),
      ], 'URL filter entries.'),
    ],
  },
  {
    path: 'webfilter profile',
    kind: 'table',
    key: 'string',
    help: 'Configure Web filter profiles.',
    fields: [
      str('comment'),
      opt('feature-set', ['flow', 'proxy'], 'flow', 'Flow/proxy feature set.'),
      obj('web', [f('urlfilter-table', 'ref', '', { ref: ['webfilter urlfilter'], help: 'URL filter table.' })], 'Web content filtering settings.'),
      obj('ftgd-wf', [subTable('filters', [int('category', '0', 'Categories and groups the filter examines.'), opt('action', ['block', 'authenticate', 'monitor', 'warning'], 'monitor', 'Action to take for matches.'), en('log', 'enable', 'Enable/disable logging.')], 'FortiGuard filters.')], 'FortiGuard Web Filter settings.'),
      en('log-all-url', 'disable', 'Enable/disable logging all URLs visited.'),
    ],
  },
  {
    path: 'dnsfilter profile',
    kind: 'table',
    key: 'string',
    help: 'Configure DNS domain filter profile.',
    fields: [
      str('comment'),
      en('block-botnet', 'disable', 'Enable/disable blocking botnet C&C DNS lookups.'),
      opt('block-action', ['block', 'redirect'], 'redirect', 'Action to take for blocked domains.'),
      obj('ftgd-dns', [subTable('filters', [int('category', '0', 'Category number.'), opt('action', ['block', 'monitor'], 'monitor', 'Action to take for DNS requests matching the category.'), en('log', 'enable', 'Enable/disable DNS filter logging for this DNS profile.')], 'FortiGuard DNS domain filters.')], 'FortiGuard DNS Filter settings.'),
    ],
  },
  {
    path: 'application list',
    kind: 'table',
    key: 'string',
    help: 'Configure application control lists.',
    fields: [
      str('comment'),
      en('enforce-default-app-port', 'disable', 'Enable/disable default application port enforcement for allowed applications.'),
      opt('other-application-action', ['pass', 'block'], 'pass', 'Action for other applications.'),
      opt('unknown-application-action', ['pass', 'block'], 'pass', 'Pass or block traffic from unknown applications.'),
      subTable('entries', [
        f('category', 'words', [], { help: 'Category ID list.' }),
        f('application', 'words', [], { help: 'ID of allowed applications.' }),
        opt('action', ['pass', 'block', 'reset'], 'block', 'Pass or block traffic, or reset connection for traffic from this application.'),
        en('log', 'enable', 'Enable/disable logging for this application list.'),
      ], 'Application list entries.'),
    ],
  },
  {
    path: 'ips sensor',
    kind: 'table',
    key: 'string',
    help: 'Configure IPS sensor.',
    fields: [
      str('comment'),
      en('block-malicious-url', 'disable', 'Enable/disable malicious URL blocking.'),
      subTable('entries', [
        f('rule', 'words', [], { help: 'Identifies the predefined or custom IPS signatures to add to the sensor.' }),
        opts('severity', ['info', 'low', 'medium', 'high', 'critical'], [], 'Relative severity of the signature, from info to critical.'),
        opt('status', ['disable', 'enable', 'default'], 'default', 'Status of the signatures included in filter.'),
        opt('action', ['pass', 'block', 'reset', 'default'], 'default', 'Action taken with traffic in which signatures are detected.'),
        en('log', 'enable', 'Enable/disable logging of signatures included in filter.'),
      ], 'IPS sensor filter.'),
    ],
  },
  {
    path: 'firewall policy',
    kind: 'table',
    key: 'int',
    help: 'Configure IPv4/IPv6 policies.',
    fields: [
      str('name', '', 'Policy name.'),
      uuid(),
      refs('srcintf', IF_REFS, 'Incoming (ingress) interface.'),
      refs('dstintf', IF_REFS, 'Outgoing (egress) interface.'),
      opt('action', ['accept', 'deny', 'ipsec'], 'deny', 'Policy action (accept/deny/ipsec).'),
      refs('srcaddr', ADDR_REFS, 'Source IPv4 address and address group names.'),
      refs('dstaddr', DSTADDR_REFS, 'Destination IPv4 address and address group names.'),
      en('srcaddr-negate', 'disable', 'When enabled srcaddr specifies what the source address must NOT be.'),
      en('dstaddr-negate', 'disable', 'When enabled dstaddr specifies what the destination address must NOT be.'),
      ref('schedule', SCHED_REFS, '', 'Schedule name.'),
      refs('service', SVC_REFS, 'Service and service group names.'),
      en('service-negate', 'disable', 'When enabled service specifies what the service must NOT be.'),
      opt('inspection-mode', ['proxy', 'flow'], 'flow', 'Policy inspection mode (Flow/proxy). Default is Flow mode.'),
      en('utm-status', 'disable', 'Enable to add one or more security profiles (AV, IPS, etc.) to the firewall policy.'),
      ref('ssl-ssh-profile', ['firewall ssl-ssh-profile'], 'no-inspection', 'Name of an existing SSL SSH profile.'),
      ref('av-profile', ['antivirus profile'], '', 'Name of an existing Antivirus profile.'),
      ref('webfilter-profile', ['webfilter profile'], '', 'Name of an existing Web filter profile.'),
      ref('dnsfilter-profile', ['dnsfilter profile'], '', 'Name of an existing DNS filter profile.'),
      ref('ips-sensor', ['ips sensor'], '', 'Name of an existing IPS sensor.'),
      ref('application-list', ['application list'], '', 'Name of an existing Application list.'),
      en('nat', 'disable', 'Enable/disable source NAT.'),
      en('ippool', 'disable', 'Enable to use IP Pools for source NAT.'),
      refs('poolname', ['firewall ippool'], 'IP Pool names.'),
      refs('groups', ['user group'], 'Names of user groups that can authenticate with this policy.'),
      refs('users', ['user local'], 'Names of individual users that can authenticate with this policy.'),
      en('fixedport', 'disable', 'Enable to prevent source NAT from changing a session\'s source port.'),
      en('match-vip', 'disable', 'Enable to match packets that have had their destination addresses changed by a VIP.'),
      opt('logtraffic', ['all', 'utm', 'disable'], 'utm', 'Enable or disable logging. Log all sessions or security profile sessions.'),
      en('logtraffic-start', 'disable', 'Record logs when a session starts.'),
      en('status', 'enable', 'Enable or disable this policy.'),
      str('comments', '', 'Comment.'),
    ],
  },
  {
    path: 'vpn ipsec phase1-interface',
    kind: 'table',
    key: 'string',
    help: 'Configure VPN remote gateway.',
    fields: [
      opt('type', ['static', 'dynamic', 'ddns'], 'static', 'Remote gateway type.'),
      ref('interface', ['system interface'], '', 'Local physical, aggregate, or VLAN outgoing interface.'),
      opt('ike-version', ['1', '2'], '1', 'IKE protocol version.'),
      opt('mode', ['aggressive', 'main'], 'main', 'ID protection mode used to establish a secure channel.'),
      opt('peertype', ['any', 'one', 'dialup', 'peer', 'peergrp'], 'any', 'Accept this peer type.'),
      en('net-device', 'disable', 'Enable/disable kernel device creation.'),
      words('proposal', 'Phase1 proposal.'),
      opts('dhgrp', ['1', '2', '5', '14', '15', '16', '19', '20', '21'], ['14', '5'], 'DH group.'),
      ip('remote-gw', '0.0.0.0', 'Remote VPN gateway.'),
      opt('authmethod', ['psk', 'signature'], 'psk', 'Authentication method.'),
      f('psksecret', 'password', '', { help: 'Pre-shared secret for PSK authentication (ASCII string or hexadecimal encoded with a leading 0x).' }),
      int('keylife', '86400', 'Time to wait in seconds before phase 1 encryption key expires.'),
      opt('dpd', ['disable', 'on-idle', 'on-demand'], 'on-demand', 'Dead Peer Detection mode.'),
      en('nattraversal', 'enable', 'Enable/disable NAT traversal.'),
      str('comments', '', 'Comment.'),
    ],
  },
  {
    path: 'vpn ipsec phase2-interface',
    kind: 'table',
    key: 'string',
    help: 'Configure VPN autokey tunnel.',
    fields: [
      ref('phase1name', ['vpn ipsec phase1-interface'], '', 'Phase 1 determines the options required for phase 2.'),
      words('proposal', 'Phase2 proposal.'),
      en('pfs', 'enable', 'Enable/disable PFS feature.'),
      opts('dhgrp', ['1', '2', '5', '14', '15', '16', '19', '20', '21'], ['14', '5'], 'Phase2 DH group.'),
      en('replay', 'enable', 'Enable/disable replay detection.'),
      en('auto-negotiate', 'disable', 'Enable/disable IPsec SA auto-negotiation.'),
      int('keylifeseconds', '43200', 'Phase2 key life in time in seconds (120 - 172800).'),
      ipmask('src-subnet', '0.0.0.0 0.0.0.0', 'Local proxy ID subnet.'),
      ipmask('dst-subnet', '0.0.0.0 0.0.0.0', 'Remote proxy ID IPv4 subnet.'),
      str('comments', '', 'Comment.'),
    ],
  },
  {
    path: 'vpn ssl web portal',
    kind: 'table',
    key: 'string',
    help: 'Portal.',
    fields: [
      en('tunnel-mode', 'disable', 'Enable/disable IPv4 SSL-VPN tunnel mode.'),
      en('web-mode', 'disable', 'Enable/disable SSL-VPN web mode.'),
      refs('ip-pools', ADDR_REFS, 'IPv4 firewall source address objects reserved for SSL-VPN tunnel mode clients.'),
      en('split-tunneling', 'enable', 'Enable/disable IPv4 split tunneling.'),
      refs('split-tunneling-routing-address', ADDR_REFS, 'IPv4 SSL-VPN tunnel mode firewall address objects that override firewall policy destination addresses to control split-tunneling access.'),
      str('heading', 'SSL-VPN Portal', 'Web portal heading message.'),
    ],
  },
  {
    path: 'vpn ssl settings',
    kind: 'object',
    help: 'Configure SSL-VPN.',
    fields: [
      opt('status', ['enable', 'disable'], 'enable', 'Enable/disable SSL-VPN.'),
      str('servercert', 'Fortinet_Factory', 'Name of the server certificate to be used for SSL-VPNs.'),
      refs('tunnel-ip-pools', ADDR_REFS, 'Names of the IPv4 IP Pool firewall objects that define the IP addresses reserved for remote clients.'),
      refs('source-interface', ['system interface', 'system zone'], 'SSL-VPN source interface of incoming traffic.'),
      refs('source-address', ADDR_REFS, 'Source address of incoming traffic.'),
      int('port', '443', 'SSL-VPN access port (1 - 65535).'),
      ref('default-portal', ['vpn ssl web portal'], '', 'Default SSL-VPN portal.'),
      table('authentication-rule', { path: 'authentication-rule', kind: 'table', key: 'int', fields: [refs('groups', ['user group'], 'User groups.'), refs('users', ['user local'], 'User name.'), ref('portal', ['vpn ssl web portal'], '', 'SSL-VPN portal.')] }, 'Authentication rule for SSL-VPN.'),
    ],
  },
  {
    path: 'system sdwan',
    kind: 'object',
    help: 'Configure redundant Internet connections with multiple outbound links and health-check profiles.',
    fields: [
      en('status', 'disable', 'Enable/disable SD-WAN.'),
      opt('load-balance-mode', ['source-ip-based', 'weight-based', 'usage-based', 'source-dest-ip-based', 'measured-volume-based'], 'source-ip-based', 'Algorithm or mode to use for load balancing Internet traffic to SD-WAN members.'),
      table('zone', { path: 'zone', kind: 'table', key: 'string', fields: [str('comment')] }, 'Configure SD-WAN zones.'),
      table('members', {
        path: 'members',
        kind: 'table',
        key: 'int',
        fields: [
          ref('interface', ['system interface'], '', 'Interface name.'),
          str('zone', 'virtual-wan-link', 'Zone name.'),
          ip('gateway', '0.0.0.0', 'The default gateway for this interface. Usually the default gateway of the Internet service provider that this interface is connected to.'),
          int('priority', '1', 'Priority of the interface for IPv4 (1 - 65535).'),
          int('cost', '0', 'Cost of this interface for services in SLA mode (0 - 4294967295).'),
          en('status', 'enable', 'Enable/disable this interface in the SD-WAN.'),
          str('comment'),
        ],
      }, 'FortiGate interfaces added to the SD-WAN.'),
      table('health-check', {
        path: 'health-check',
        kind: 'table',
        key: 'string',
        fields: [
          strs('server', 'IP address or FQDN name of the server.'),
          opt('protocol', ['ping', 'tcp-echo', 'udp-echo', 'http', 'dns', 'tcp-connect'], 'ping', 'Protocol used to determine if the FortiGate can communicate with the server.'),
          int('interval', '500', 'Status check interval in milliseconds.'),
          int('failtime', '5', 'Number of failures before server is considered lost.'),
          int('recoverytime', '5', 'Number of successful responses received before server is considered recovered.'),
          words('members', 'Member sequence number list.'),
          table('sla', { path: 'sla', kind: 'table', key: 'int', fields: [int('latency-threshold', '5', 'Latency for SLA to make decision in milliseconds.'), int('jitter-threshold', '5', 'Jitter for SLA to make decision in milliseconds.'), int('packetloss-threshold', '0', 'Packet loss for SLA to make decision in percentage.')] }, 'Service level agreement (SLA).'),
        ],
      }, 'SD-WAN status checking or health checking.'),
      table('service', {
        path: 'service',
        kind: 'table',
        key: 'int',
        fields: [
          str('name', '', 'SD-WAN rule name.'),
          opt('mode', ['auto', 'manual', 'priority', 'sla', 'load-balance'], 'manual', 'Control how the SD-WAN rule sets the priority of interfaces in the SD-WAN.'),
          refs('dst', ADDR_REFS, 'Destination address name.'),
          refs('src', ADDR_REFS, 'Source address name.'),
          int('protocol', '0', 'Protocol number.'),
          int('start-port', '1', 'Start destination port number.'),
          int('end-port', '65535', 'End destination port number.'),
          words('priority-members', 'Member sequence number list.'),
          strs('health-check', 'Health check list.'),
          table('sla', { path: 'sla', kind: 'table', key: 'string', fields: [int('id', '1', 'SLA ID.')] }, 'Service level agreement (SLA).'),
          en('status', 'enable', 'Enable/disable SD-WAN service.'),
        ],
      }, 'Create SD-WAN rules (also called services) to control how sessions are distributed to interfaces in the SD-WAN.'),
    ],
  },
  {
    path: 'router static',
    kind: 'table',
    key: 'int',
    help: 'Configure IPv4 static routing tables.',
    fields: [
      en('status', 'enable', 'Enable/disable this static route.'),
      ipmask('dst', '0.0.0.0 0.0.0.0', 'Destination IP and mask for this route.'),
      ip('gateway', '0.0.0.0', 'Gateway IP for this route.'),
      int('distance', '10', 'Administrative distance (1 - 255).'),
      int('weight', '0', 'Administrative weight (0 - 255).'),
      int('priority', '1', 'Administrative priority (1 - 65535).'),
      ref('device', ['system interface'], '', 'Gateway out interface or tunnel.'),
      strs('sdwan-zone', 'Choose SD-WAN Zone.'),
      en('blackhole', 'disable', 'Enable/disable black hole.'),
      str('comment', '', 'Optional comments.'),
    ],
  },
  {
    path: 'router policy',
    kind: 'table',
    key: 'int',
    help: 'Configure IPv4 routing policies.',
    fields: [
      refs('input-device', ['system interface'], 'Incoming interface name.'),
      f('src', 'strings', [], { help: 'Source IP and mask (x.x.x.x/x).' }),
      f('dst', 'strings', [], { help: 'Destination IP and mask (x.x.x.x/x).' }),
      int('protocol', '0', 'Protocol number (0 - 255). 0 = any.'),
      int('start-port', '1', 'Start destination port number (0 - 65535).'),
      int('end-port', '65535', 'End destination port number (0 - 65535).'),
      ip('gateway', '0.0.0.0', 'IP address of the gateway.'),
      ref('output-device', ['system interface'], '', 'Outgoing interface name.'),
      opt('action', ['deny', 'permit'], 'permit', 'Action of the policy route: permit = use this route, deny = stop policy routing and use the routing table.'),
      en('status', 'enable', 'Enable/disable this policy route.'),
      str('comments', '', 'Optional comments.'),
    ],
  },
  {
    path: 'router bgp',
    kind: 'object',
    help: 'Configure BGP.',
    fields: [
      int('as', '0', 'Router AS number, valid from 1 to 4294967295, 0 to disable BGP.'),
      ip('router-id', '0.0.0.0', 'Router ID.'),
      table('neighbor', { path: 'neighbor', kind: 'table', key: 'string', fields: [int('remote-as', '0', 'AS number of neighbor.'), str('description', '', 'Description.'), en('shutdown', 'disable', 'Enable/disable shutdown this neighbor.'), int('holdtime-timer', '180', 'Interval (sec) before peer considered dead.'), int('keep-alive-timer', '60', 'Keep alive timer interval (sec).')] }, 'BGP neighbor table.'),
      table('network', { path: 'network', kind: 'table', key: 'int', fields: [ipmask('prefix', '0.0.0.0 0.0.0.0', 'Network prefix.')] }, 'BGP network table.'),
    ],
  },
  {
    path: 'router ospf',
    kind: 'object',
    help: 'Configure OSPF.',
    fields: [
      ip('router-id', '0.0.0.0', 'Router ID.'),
      table('area', { path: 'area', kind: 'table', key: 'string', fields: [opt('type', ['regular', 'nssa', 'stub'], 'regular', 'Area type setting.')] }, 'OSPF area configuration.'),
      table('ospf-interface', { path: 'ospf-interface', kind: 'table', key: 'string', fields: [ref('interface', ['system interface'], '', 'Configuration interface name.'), opt('network-type', ['broadcast', 'non-broadcast', 'point-to-point', 'point-to-multipoint'], 'broadcast', 'Network type.'), int('cost', '0', 'Cost of the interface, value range from 0 to 65535, 0 means auto-cost.'), int('hello-interval', '10', 'Hello interval.'), int('dead-interval', '40', 'Dead interval.')] }, 'OSPF interface configuration.'),
      table('network', { path: 'network', kind: 'table', key: 'int', fields: [ipmask('prefix', '0.0.0.0 0.0.0.0', 'Prefix.'), ip('area', '0.0.0.0', 'Attach the network to area.')] }, 'OSPF network configuration.'),
      en('default-information-originate', 'disable', 'Enable/disable generation of default route.'),
    ],
  },
  {
    path: 'firewall local-in-policy',
    kind: 'table',
    key: 'int',
    help: 'Configure user defined IPv4 local-in policies.',
    fields: [
      ref('intf', IF_REFS, '', 'Incoming interface name from available options.'),
      refs('srcaddr', ADDR_REFS, 'Source address object from available options.'),
      refs('dstaddr', ADDR_REFS, 'Destination address object from available options.'),
      opt('action', ['accept', 'deny'], 'deny', 'Action performed on traffic matching the policy.'),
      refs('service', SVC_REFS, 'Service object from available options.'),
      ref('schedule', SCHED_REFS, '', 'Schedule object from available options.'),
      en('status', 'enable', 'Enable/disable this local-in policy.'),
      str('comments', '', 'Comment.'),
    ],
  },
  {
    path: 'system snmp sysinfo',
    kind: 'object',
    help: 'SNMP system info configuration.',
    fields: [
      en('status', 'disable', 'Enable/disable SNMP.'),
      str('description', '', 'System description.'),
      str('contact-info', '', 'Contact information.'),
      str('location', '', 'System location.'),
    ],
  },
  {
    path: 'system snmp community',
    kind: 'table',
    key: 'int',
    help: 'SNMP community configuration.',
    fields: [
      str('name', '', 'Community name.'),
      en('status', 'enable', 'Enable/disable this SNMP community.'),
      table('hosts', { path: 'hosts', kind: 'table', key: 'int', fields: [ipmask('ip', '0.0.0.0 0.0.0.0', 'IPv4 address of the SNMP manager (host).')] }, 'Configure IPv4 SNMP managers (hosts).'),
      en('query-v1-status', 'enable', 'Enable/disable SNMP v1 queries.'),
      en('query-v2c-status', 'enable', 'Enable/disable SNMP v2c queries.'),
      en('trap-v2c-status', 'enable', 'Enable/disable SNMP v2c traps.'),
    ],
  },
  {
    path: 'log syslogd setting',
    kind: 'object',
    help: 'Global settings for remote syslog server.',
    fields: [
      en('status', 'disable', 'Enable/disable remote syslog logging.'),
      str('server', '', 'Address of remote syslog server.'),
      int('port', '514', 'Server listen port.'),
      opt('mode', ['udp', 'legacy-reliable', 'reliable'], 'udp', 'Remote syslog logging over UDP/Reliable TCP.'),
      opt('facility', ['kernel', 'user', 'mail', 'daemon', 'auth', 'syslog', 'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7'], 'local7', 'Remote syslog facility.'),
      ip('source-ip', '0.0.0.0', 'Source IP address of syslog.'),
    ],
  },
  {
    path: 'log setting',
    kind: 'object',
    help: 'Configure general log settings.',
    fields: [
      en('fwpolicy-implicit-log', 'disable', 'Enable/disable implicit firewall policy logging.'),
      en('local-in-allow', 'disable', 'Enable/disable local-in-allow logging.'),
      en('local-in-deny-unicast', 'disable', 'Enable/disable local-in-deny-unicast logging.'),
      en('resolve-ip', 'disable', 'Enable/disable adding resolved domain names to traffic logs if possible.'),
    ],
  },
];

export const SCHEMA_MAP: Record<string, PathDef> = Object.fromEntries(SCHEMA.map((p) => [p.path, p]));

/** Fields whose values are printed inside double quotes. */
export const QUOTED: FieldType[] = ['string', 'ref', 'refs', 'strings', 'datetime'];
