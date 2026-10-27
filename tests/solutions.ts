// Reference solutions for every lab. Used by the solvability test and by the course screenshots.
import * as store from '../src/store';
import { getCli } from '../src/cli/session';

export const cli = getCli();
const run = (ls: string[]) => ls.forEach((l) => cli.submit(l));
const pol = (id: string, sets: string[]) => ['config firewall policy', `edit ${id}`, ...sets, 'next', 'end'];
const ALLGRP = ['secfabgrp', 'ftviewgrp', 'authgrp', 'sysgrp', 'netgrp', 'loggrp', 'fwgrp', 'vpngrp', 'utmgrp'];

const vpn = [
  'config vpn ipsec phase1-interface', 'edit to-branch', 'set interface wan1', 'set ike-version 2', 'set remote-gw 198.51.100.200', 'set psksecret Branch-PSK-2026', 'next', 'end',
  'config vpn ipsec phase2-interface', 'edit to-branch', 'set phase1name to-branch', 'set src-subnet 192.168.1.0/24', 'set dst-subnet 10.20.0.0/24', 'next', 'end',
  'config firewall address', 'edit HQ', 'set subnet 192.168.1.0/24', 'next', 'edit BR', 'set subnet 10.20.0.0/24', 'next', 'end',
  'config router static', 'edit 0', 'set dst 10.20.0.0/24', 'set device to-branch', 'next', 'edit 0', 'set dst 10.20.0.0/24', 'set blackhole enable', 'set distance 254', 'next', 'end',
  ...pol('0', ['set name hq-br', 'set srcintf internal', 'set dstintf to-branch', 'set srcaddr HQ', 'set dstaddr BR', 'set schedule always', 'set service ALL', 'set action accept']),
  ...pol('0', ['set name br-hq', 'set srcintf to-branch', 'set dstintf internal', 'set srcaddr BR', 'set dstaddr HQ', 'set schedule always', 'set service ALL', 'set action accept']),
];

export const SOL: Record<string, () => void> = {
  'l1-basics': () => {
    run(['config system global', 'set hostname HQ-FGT', 'set admintimeout 15', 'end', 'get system status']);
    store.sendTraffic({ srcHost: 'pc1', dst: '192.168.1.99', proto: 'icmp', dport: 0 });
  },
  'l2-first-policy': () => run(pol('0', ['set name out', 'set srcintf internal', 'set dstintf wan1', 'set srcaddr all', 'set dstaddr all', 'set schedule always', 'set service ALL', 'set action accept', 'set nat enable'])),
  'l3-logging': () => {
    run([...pol('1', ['set logtraffic all']), 'config log setting', 'set fwpolicy-implicit-log enable', 'end']);
    store.sendTraffic({ srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 });
    store.sendTraffic({ srcHost: 'web', dst: '192.168.1.110', proto: 'tcp', dport: 3389 });
  },
  'l4-objects': () => run(['config firewall address', 'edit LAN-Net', 'set subnet 192.168.1.0/24', 'next', 'end', 'config firewall service group', 'edit Web-Basic', 'set member DNS HTTP HTTPS', 'next', 'end', ...pol('1', ['set srcaddr LAN-Net', 'set service Web-Basic'])]),
  'l5-vip': () => run(['config firewall vip', 'edit Web', 'set extintf wan1', 'set extip 203.0.113.10', 'set mappedip 10.10.10.10', 'set portforward enable', 'set extport 80', 'set mappedport 80', 'next', 'end', ...pol('0', ['set name in', 'set srcintf wan1', 'set dstintf dmz', 'set srcaddr all', 'set dstaddr Web', 'set schedule always', 'set service HTTP', 'set action accept'])]),
  'l6-order': () => run(['config firewall policy', 'move 2 before 1', 'end']),
  'l7-renumber': () => run(['config system interface', 'edit internal', 'set ip 192.168.10.1/24', 'next', 'end', 'config system dhcp server', 'edit 2', 'set default-gateway 192.168.10.1', 'config ip-range', 'edit 1', 'set start-ip 192.168.10.100', 'set end-ip 192.168.10.200', 'next', 'end', 'next', 'end', 'config firewall address', 'edit LAN-Subnet', 'set subnet 192.168.10.0/24', 'next', 'end']),
  'l8-harden': () =>
    run([
      'config system accprofile', 'edit ro', ...ALLGRP.map((g) => `set ${g} read`), 'next', 'end',
      'config system admin', 'edit auditor', 'set accprofile ro', 'set vdom root', 'set password Audit12', 'set trusthost1 192.168.1.0/24', 'next', 'end',
      'config firewall address', 'edit Office', 'set subnet 198.51.100.77/32', 'next', 'end',
      'config firewall local-in-policy', 'edit 1', 'set intf wan1', 'set srcaddr Office', 'set dstaddr all', 'set service HTTPS', 'set schedule always', 'set action accept', 'next',
      'edit 2', 'set intf wan1', 'set srcaddr all', 'set dstaddr all', 'set service HTTPS', 'set schedule always', 'set action deny', 'next', 'end',
      'config system interface', 'edit wan1', 'unselect allowaccess ssh', 'next', 'end',
    ]),
  'l9-ldap': () => {
    run([
      'config user ldap', 'edit AD', 'set server 10.10.10.20', 'set dn dc=lab,dc=local', 'set type regular', 'set username cn=fwbind,cn=Users,dc=lab,dc=local', 'set password Bind123!', 'next', 'end',
      'config user group', 'edit Sales', 'set member AD', 'config match', 'edit 1', 'set server-name AD', 'set group-name "CN=Sales,OU=Groups,DC=lab,DC=local"', 'next', 'end', 'next', 'end',
      ...pol('1', ['set groups Sales']),
    ]);
    store.firewallLogin('pc1', 'jsmith', 'Sales123!');
    store.firewallLogin('pc2', 'adoe', 'Eng123!');
  },
  'l10-ipsec': () => run(vpn),
  'l11-sslvpn': () => {
    run([
      'config user local', 'edit r1', 'set passwd R1pass99', 'next', 'end',
      'config user group', 'edit VPN', 'set member r1', 'next', 'end',
      'config vpn ssl settings', 'set source-interface wan1', 'set port 10443', 'config authentication-rule', 'edit 1', 'set groups VPN', 'set portal tunnel-access', 'next', 'end', 'end',
      'config firewall address', 'edit LANnet', 'set subnet 192.168.1.0/24', 'next', 'end',
      ...pol('0', ['set name ssl', 'set srcintf ssl.root', 'set dstintf internal', 'set srcaddr all', 'set dstaddr LANnet', 'set groups VPN', 'set schedule always', 'set service ALL', 'set action accept']),
    ]);
    store.sslVpnConnect('laptop', '203.0.113.10', 10443, 'r1', 'R1pass99');
  },
  'l12-sdwan': () => {
    run([
      'config system sdwan', 'set status enable', 'config zone', 'edit virtual-wan-link', 'next', 'end',
      'config members', 'edit 2', 'set interface wan2', 'set gateway 198.18.10.1', 'next', 'end', 'end',
      ...pol('1', ['set dstintf virtual-wan-link']),
      ...pol('3', ['set dstintf virtual-wan-link']),
      'config system sdwan', 'config members', 'edit 1', 'set interface wan1', 'set gateway 203.0.113.1', 'next', 'end',
      'config health-check', 'edit G', 'set server 8.8.8.8', 'set members 1 2', 'config sla', 'edit 1', 'set latency-threshold 50', 'next', 'end', 'next', 'end', 'end',
      'config router static', 'edit 0', 'set sdwan-zone virtual-wan-link', 'next', 'end',
    ]);
    store.updateLab((l) => ({ ...l, ispDown: { wan1: true } }));
  },
  'l13-dynamic': () =>
    run([
      'config router bgp', 'set as 65010', 'config neighbor', 'edit 203.0.113.1', 'set remote-as 64500', 'next', 'end', 'end',
      'config system interface', 'edit to-branch', 'set ip 169.254.1.1/32', 'set remote-ip 169.254.1.2/30', 'next', 'end',
      'config router ospf', 'config area', 'edit 0.0.0.0', 'next', 'end', 'config network', 'edit 1', 'set prefix 169.254.1.0/30', 'set area 0.0.0.0', 'next', 'end', 'end',
      'config router static', 'delete 1', 'end',
    ]),
  'c1-no-internet': () => run(pol('1', ['set nat enable'])),
  'c2-dns': () => run(pol('1', ['append service DNS'])),
  'c3-website': () => run(['config firewall vip', 'edit VIP-WebServer-HTTP', 'set mappedip 10.10.10.10', 'next', 'end']),
  'c4-dhcp': () => run(['config system dhcp server', 'edit 2', 'config ip-range', 'edit 1', 'set end-ip 192.168.1.210', 'next', 'end', 'next', 'end']),
  'c5-branch': () => run(['config vpn ipsec phase1-interface', 'edit to-branch', 'set psksecret Branch-PSK-2026', 'next', 'end', 'config router static', 'edit 0', 'set dst 10.20.0.0/24', 'set device to-branch', 'next', 'end']),
  'c6-failover': () => run(['config system sdwan', 'config health-check', 'edit Internet', 'set server 8.8.8.8', 'set members 1 2', 'next', 'end', 'end']),
};

export const solve = (id: string) => SOL[id]?.();
