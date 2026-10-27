import { BarChart3, FileText, GraduationCap, LayoutDashboard, Lock, Network, Settings, Shield, Users, type LucideIcon } from 'lucide-react';

export interface MenuLeaf {
  id: string;
  label: string;
  phase?: number; // not built yet: shows a "coming in phase N" page
  learn?: string[];
}

export interface MenuGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: MenuLeaf[];
}

export const MENU: MenuGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [
      { id: 'dash-status', label: 'Status' },
      { id: 'dash-network', label: 'Network' },
      { id: 'dash-security', label: 'Security', phase: 4, learn: ['Top threats, IPS/AV events, compromised hosts'] },
      { id: 'dash-sessions', label: 'FortiView Sessions' },
      { id: 'dash-users', label: 'Firewall User Monitor' },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    items: [
      { id: 'net-interfaces', label: 'Interfaces' },
      { id: 'net-dns', label: 'DNS' },
      { id: 'net-capture', label: 'Packet Capture', phase: 3, learn: ['Capture packets on an interface with filters', 'Same as "diagnose sniffer packet" in the CLI'] },
      { id: 'net-sdwan', label: 'SD-WAN' },
      { id: 'net-static', label: 'Static Routes' },
      { id: 'net-pbr', label: 'Policy Routes' },
      { id: 'net-ospf', label: 'OSPF' },
      { id: 'net-bgp', label: 'BGP' },
    ],
  },
  {
    id: 'policy',
    label: 'Policy & Objects',
    icon: FileText,
    items: [
      { id: 'pol-policy', label: 'Firewall Policy' },
      { id: 'pol-address', label: 'Addresses' },
      { id: 'pol-isdb', label: 'Internet Service Database', phase: 4, learn: ['Match well-known SaaS services by IP database instead of addresses'] },
      { id: 'pol-service', label: 'Services' },
      { id: 'pol-schedule', label: 'Schedules' },
      { id: 'pol-vip', label: 'Virtual IPs' },
      { id: 'pol-localin', label: 'Local-In Policy' },
      { id: 'pol-ippool', label: 'IP Pools' },
      { id: 'pol-protocol', label: 'Protocol Options', phase: 4, learn: ['Ports per protocol for proxy inspection', 'Oversized file handling'] },
      { id: 'pol-shaping', label: 'Traffic Shaping', phase: 6, learn: ['Shapers, shaping policies, bandwidth guarantees'] },
    ],
  },
  {
    id: 'security',
    label: 'Security Profiles',
    icon: Shield,
    items: [
      { id: 'sec-av', label: 'AntiVirus', phase: 4, learn: ['Flow vs proxy AV', 'EICAR test files', 'Quarantine and logs'] },
      { id: 'sec-web', label: 'Web Filter', phase: 4, learn: ['FortiGuard categories', 'Block / warn / monitor / authenticate', 'Static URL filters'] },
      { id: 'sec-dns', label: 'DNS Filter', phase: 4, learn: ['Block domains at DNS level', 'Botnet C&C blocking'] },
      { id: 'sec-app', label: 'Application Control', phase: 4, learn: ['Block apps like BitTorrent or social media regardless of port'] },
      { id: 'sec-ips', label: 'Intrusion Prevention', phase: 4, learn: ['IPS sensors and signatures', 'Severity, action, logs'] },
      { id: 'sec-ssl', label: 'SSL/SSH Inspection', phase: 4, learn: ['Certificate vs deep inspection', 'Why deep inspection needs a trusted CA'] },
    ],
  },
  {
    id: 'vpn',
    label: 'VPN',
    icon: Lock,
    items: [
      { id: 'vpn-ipsec', label: 'IPsec Tunnels' },
      { id: 'vpn-wizard', label: 'IPsec Wizard' },
      { id: 'vpn-sslportal', label: 'SSL-VPN Portals' },
      { id: 'vpn-sslsettings', label: 'SSL-VPN Settings' },
    ],
  },
  {
    id: 'user',
    label: 'User & Authentication',
    icon: Users,
    items: [
      { id: 'usr-def', label: 'User Definition' },
      { id: 'usr-grp', label: 'User Groups' },
      { id: 'usr-ldap', label: 'LDAP Servers' },
      { id: 'usr-radius', label: 'RADIUS Servers' },
      { id: 'usr-settings', label: 'Authentication Settings' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    items: [
      { id: 'sys-admins', label: 'Administrators' },
      { id: 'sys-profiles', label: 'Admin Profiles' },
      { id: 'sys-firmware', label: 'Firmware & Registration' },
      { id: 'sys-settings', label: 'Settings' },
      { id: 'sys-ha', label: 'HA', phase: 6, learn: ['FGCP active-passive / active-active', 'Failover drill', 'get system ha status'] },
      { id: 'sys-snmp', label: 'SNMP' },
      { id: 'sys-certs', label: 'Certificates', phase: 4 },
    ],
  },
  {
    id: 'log',
    label: 'Log & Report',
    icon: BarChart3,
    items: [
      { id: 'log-forward', label: 'Forward Traffic' },
      { id: 'log-local', label: 'Local Traffic' },
      { id: 'log-events', label: 'System Events' },
      { id: 'log-security', label: 'Security Events', phase: 4 },
      { id: 'log-settings', label: 'Log Settings' },
    ],
  },
];

// Not part of FortiOS: the FWallSim training area.
MENU.push({ id: 'training', label: 'Training (FWallSim)', icon: GraduationCap, items: [{ id: 'training', label: 'Labs & Challenges' }] });

export const LEAVES: Record<string, MenuLeaf & { group: string }> = Object.fromEntries(MENU.flatMap((g) => g.items.map((i) => [i.id, { ...i, group: g.label }])));
