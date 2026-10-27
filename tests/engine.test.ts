// Engine regression suite: run with `npm run test:engine`. Exits non-zero on any failure.
import './stubs';
import * as store from '../src/store';
import { getCli } from '../src/cli/session';
import { buildNet } from '../src/engine/net';
import { parseConfigText, serializeConfig } from '../src/engine/serialize';
import { starterConfig } from '../src/engine/defaults';
import { sha256 } from '../src/engine/sha256';
import { isPwHash } from '../src/engine/admin';

let failed = 0;
let passed = 0;
function check(name: string, cond: unknown, detail = '') {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}
const cli = getCli();
const run = (...ls: string[]) => ls.forEach((l) => cli.submit(l));
const send = (srcHost: string, dst: string, proto: 'tcp' | 'udp' | 'icmp' = 'tcp', dport = 443) => store.sendTraffic({ srcHost, dst, proto, dport });
const net = () => buildNet(store.getState().config);
const section = (s: string) => console.log(`-- ${s}`);

store.login('admin', '', 'pc1');

section('packet flow, NAT, VIP, local-in');
store.loadScenario('factory');
check('factory: implicit deny', !send('pc1', '8.8.8.8', 'icmp', 0).ok);
check('factory: ping own gateway (local-in)', send('pc1', '192.168.1.99', 'icmp', 0).ok);
check('factory: same-subnet PCs talk without policy', send('pc1', '192.168.1.111', 'icmp', 0).summary.includes('did not pass through the firewall'));
store.loadScenario('starter');
check('starter: browse by name (DNS + HTTPS)', send('pc1', 'www.example.com').ok);
check('starter: VIP inbound HTTP', send('user', '203.0.113.10', 'tcp', 80).ok);
check('starter: SSH to wan1 denied by admin access', !send('attacker', '203.0.113.10', 'tcp', 22).ok);
run('config firewall policy', 'edit 1', 'set nat disable', 'next', 'end');
check('no NAT: reply cannot return', send('pc1', '8.8.8.8', 'icmp', 0).summary.includes('reply cannot return'));
run('config firewall policy', 'edit 1', 'set nat enable', 'next', 'end');

section('config file round trip');
const txt = serializeConfig(starterConfig());
check('backup -> restore -> backup is identical', serializeConfig(parseConfigText(txt)) === txt);

section('CLI');
run('config firewall policy', 'edit 0', 'set srcintf nosuch');
check('CLI rejects unknown reference', cli.out.slice(-3).join(' ').includes('entry not found in datasource'));
run('abort', 'end', 'config firewall policy', 'edit 0', 'set name x', 'next');
check('CLI requires mandatory attributes', cli.out.slice(-3).join(' ').includes("MUST be set"));
run('abort', 'end');
check('CLI tab completion', cli.complete('sh') === 'show ');

section('authentication');
run('config user ldap', 'edit AD', 'set server 10.10.10.20', 'set dn dc=lab,dc=local', 'set type regular', 'set username cn=fwbind,cn=Users,dc=lab,dc=local', 'set password Bind123!', 'next', 'end',
  'config user group', 'edit Sales', 'set member AD', 'config match', 'edit 1', 'set server-name AD', 'set group-name "CN=Sales,OU=Groups,DC=lab,DC=local"', 'next', 'end', 'next', 'end',
  'config firewall policy', 'edit 1', 'set groups Sales', 'next', 'end');
check('unauthenticated web is sent to the portal', send('pc1', '93.184.216.34').summary.includes('authentication portal'));
check('wrong password refused', !store.firewallLogin('pc1', 'jsmith', 'nope').ok);
check('jsmith logs in', store.firewallLogin('pc1', 'jsmith', 'Sales123!').ok);
check('jsmith browses', send('pc1', 'www.example.com').ok);
store.firewallLogin('pc2', 'adoe', 'Eng123!');
check('adoe (wrong group) denied', !send('pc2', 'www.example.com').ok);

section('IPsec VPN');
store.loadScenario('starter');
const tun = () => net().tunnels['to-branch'];
run('config vpn ipsec phase1-interface', 'edit to-branch', 'set interface wan1', 'set remote-gw 198.51.100.200', 'set psksecret Branch-PSK-2026', 'next', 'end',
  'config vpn ipsec phase2-interface', 'edit to-branch', 'set phase1name to-branch', 'set src-subnet 192.168.1.0/24', 'set dst-subnet 10.20.0.0/24', 'next', 'end');
check('IKE version mismatch detected', tun().error?.includes('IKE version mismatch'));
run('config vpn ipsec phase1-interface', 'edit to-branch', 'set ike-version 2', 'set psksecret bad', 'next', 'end');
check('PSK mismatch detected', tun().error?.includes('AUTHENTICATION_FAILED'));
run('config vpn ipsec phase1-interface', 'edit to-branch', 'set psksecret Branch-PSK-2026', 'next', 'end', 'config vpn ipsec phase2-interface', 'edit to-branch', 'set dst-subnet 10.30.0.0/24', 'next', 'end');
check('selector mismatch detected', tun().error?.includes('TS_UNACCEPTABLE'));
run('config vpn ipsec phase2-interface', 'edit to-branch', 'set dst-subnet 10.20.0.0/24', 'next', 'end',
  'config router static', 'edit 0', 'set dst 10.20.0.0/24', 'set device to-branch', 'next', 'end',
  'config firewall address', 'edit HQ', 'set subnet 192.168.1.0/24', 'next', 'edit BR', 'set subnet 10.20.0.0/24', 'next', 'end',
  'config firewall policy', 'edit 0', 'set name a', 'set srcintf internal', 'set dstintf to-branch', 'set srcaddr HQ', 'set dstaddr BR', 'set schedule always', 'set service ALL', 'set action accept', 'set nat enable', 'next',
  'edit 0', 'set name b', 'set srcintf to-branch', 'set dstintf internal', 'set srcaddr BR', 'set dstaddr HQ', 'set schedule always', 'set service ALL', 'set action accept', 'next', 'end');
check('tunnel up', tun().up);
check('NAT on VPN policy breaks the selector', send('pc1', '10.20.0.10', 'icmp', 0).summary.includes('no matching IPsec selector'));
run('config firewall policy', 'edit 4', 'set nat disable', 'next', 'end');
check('HQ -> branch', send('pc1', '10.20.0.10', 'icmp', 0).ok);
check('branch -> HQ', send('branchpc', '192.168.1.110', 'tcp', 3389).ok);

section('dynamic routing');
run('config router bgp', 'set as 65010', 'config neighbor', 'edit 203.0.113.1', 'set remote-as 64500', 'next', 'end', 'end',
  'config system interface', 'edit to-branch', 'set ip 169.254.1.1/32', 'set remote-ip 169.254.1.2/30', 'next', 'end',
  'config router ospf', 'config area', 'edit 0.0.0.0', 'next', 'end', 'config network', 'edit 1', 'set prefix 169.254.1.0/30', 'set area 0.0.0.0', 'next', 'end', 'end');
check('BGP established', net().bgp.neighbors[0]?.state === 'Established');
check('OSPF full', net().ospf.neighbors[0]?.state === 'Full');
check('static (10) beats OSPF (110)', net().routes.some((r) => r.type === 'ospf' && !r.active));
run('config router static', 'delete 1', 'end');
check('OSPF route active after static removed', net().routes.some((r) => r.type === 'ospf' && r.active));

section('SD-WAN');
store.loadScenario('starter');
store.updateLab((l) => ({ ...l, wan2Cable: true, ispDown: { wan1: true } }));
check('outage without SD-WAN blackholes', !send('pc1', '8.8.8.8', 'icmp', 0).ok);
run('config system sdwan', 'set status enable', 'config zone', 'edit virtual-wan-link', 'next', 'end', 'config members', 'edit 1', 'set interface wan1', 'set gateway 203.0.113.1', 'next', 'edit 2', 'set interface wan2', 'set gateway 198.18.10.1', 'next', 'end',
  'config health-check', 'edit G', 'set server 203.0.113.1', 'set members 1', 'next', 'end', 'end',
  'config router static', 'edit 0', 'set sdwan-zone virtual-wan-link', 'next', 'end',
  'config firewall policy', 'edit 1', 'set dstintf virtual-wan-link', 'next', 'end');
check('health check to ISP gateway misses the outage', net().sdwan.members.find((m) => m.intf === 'wan1')?.alive === true);
run('config system sdwan', 'config health-check', 'edit G', 'set server 8.8.8.8', 'set members 1 2', 'next', 'end', 'end');
check('health check to 8.8.8.8 marks wan1 dead', net().sdwan.members.find((m) => m.intf === 'wan1')?.alive === false);
check('failover to wan2', send('pc1', '8.8.8.8', 'icmp', 0).ok);
store.updateLab((l) => ({ ...l, ispDown: {} }));

section('admin access');
store.loadScenario('starter');
run('config system accprofile', 'edit ro', ...['secfabgrp', 'ftviewgrp', 'authgrp', 'sysgrp', 'netgrp', 'loggrp', 'fwgrp', 'vpngrp', 'utmgrp'].map((g) => `set ${g} read`), 'next', 'end',
  'config system admin', 'edit ro1', 'set accprofile ro', 'set vdom root', 'set password Ro12345', 'set trusthost1 192.168.1.110/32', 'next', 'end');
store.logout();
check('untrusted host refused', store.login('ro1', 'Ro12345', 'pc2') !== null);
store.login('ro1', 'x', 'pc1');
store.login('ro1', 'x', 'pc1');
check('lockout after 3 failures', (store.login('ro1', 'x', 'pc1') ?? '').includes('locked'));
store.getState().runtime.adminLock['192.168.1.110'].until = 0;
check('login after lockout', store.login('ro1', 'Ro12345', 'pc1') === null);
check('read-only profile cannot write', !store.updateConfig((c) => { c['system dns'] = { kind: 'object', f: { primary: '1.1.1.1' } }; }));
store.logout();
store.login('admin', '', 'pc1');

section('management');
run('config system interface', 'edit dmz', 'append allowaccess snmp', 'next', 'end', 'config system snmp sysinfo', 'set status enable', 'end',
  'config system snmp community', 'edit 1', 'set name ro', 'next', 'end');
check('snmpwalk with right community', store.snmpWalkFromNms('ro').ok);
check('snmpwalk with wrong community times out', !store.snmpWalkFromNms('public').ok);
run('config log syslogd setting', 'set status enable', 'set server 10.10.10.30', 'end');
send('pc1', '8.8.8.8', 'icmp', 0);
check('syslog delivered', store.getState().runtime.syslog.length > 0);
check('upgrade path enforced', store.firmwareUpgrade('7.6.0') !== null);

section('CLI robustness: odd input never throws');
{
  const odd = [
    '', '   ', '?', 'end', 'next', 'abort', 'show', 'get', 'diagnose', 'execute', 'config', 'edit', 'set', 'unset', 'append', 'select', 'delete', 'purge',
    'show nosuch', 'get nosuch thing', 'config nosuch', 'config firewall', 'config firewall policy', 'edit', 'edit -1', 'edit 999999999999', 'edit abc',
    'set', 'set nosuch 1', 'set srcintf', 'set action maybe', 'set schedule', 'unset nosuch', 'append service', 'show', 'get', 'end', 'end', 'end',
    'config system interface', 'edit internal', 'set ip 999.1.1.1/24', 'set ip 10.0.0.1/33', 'set ip', 'set allowaccess pingg', 'set mtu -5', 'next', 'end',
    'config router static', 'edit 0', 'set dst 0.0.0.0/0', 'set gateway 1.2.3', 'set device nosuch', 'next', 'end',
    'config firewall address', 'edit "has space"', 'set subnet 10.1.1.0/24', 'next', 'rename "has space" to x', 'clone x to y', 'delete nosuch', 'end',
    'config system global', 'set hostname', 'set hostname ' + 'x'.repeat(300), 'set admintimeout 99999', 'end',
    'diagnose debug flow filter addr', 'diagnose debug flow trace start abc', 'diagnose sniffer packet', 'diagnose sniffer packet any "host" 9', 'diagnose sys session list',
    'execute ping', 'execute ping 999.0.0.1', 'execute traceroute', 'execute nosuch', 'get router info routing-table nosuch', 'get router info bgp neighbors 1.2.3.4',
    'show firewall policy 0', 'show full-configuration nosuch', 'get system status extra args here', 'sh sys glo', 'conf sys int', 'end',
    '"', "'", '\\', 'set "', 'edit "', 'config "firewall policy', '|', '| grep', 'show | grep', 'show firewall policy | grep accept', 'show | grep "',
  ];
  let threw = '';
  for (const l of odd) {
    try {
      cli.submit(l);
    } catch (e) {
      threw = `${JSON.stringify(l)} -> ${(e as Error).message}`;
      break;
    }
  }
  check('no CLI input throws', !threw, threw);
  run('abort', 'abort', 'end', 'end', 'end');
  check('CLI back at the global prompt', !cli.prompt().includes('('), cli.prompt());
  run('config firewall policy', 'edit 999999999999');
  check('policy ID above 4294967294 refused', !cli.prompt().includes('999999999999'), cli.prompt());
  run('end');
  const g = () => (store.getState().config['system global'] as { f: Record<string, string> }).f;
  run('config system global', 'set admintimeout 900', 'set admintimeout 0', 'end');
  check('admintimeout outside 1-480 refused', g().admintimeout !== '900' && g().admintimeout !== '0', g().admintimeout);
  run('config firewall service custom', 'edit QA-Svc', 'set tcp-portrange 0', 'set tcp-portrange 90-80', 'set tcp-portrange 70000', 'set tcp-portrange 8080-8090:1024-65535', 'next', 'end');
  const svc = JSON.stringify(store.getState().config['firewall service custom']);
  check('bad port ranges refused, valid dst:src range kept', svc.includes('8080-8090:1024-65535') && !svc.includes('"90-80"') && !svc.includes('70000'));
  check('bad interface IP not saved', !String(store.getState().config['system interface']?.kind === 'table' && JSON.stringify(store.getState().config['system interface'])).includes('999.1.1.1'));
}

section('first login and admin password hashing');
{
  check('sha256("abc")', sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('sha256(two blocks)', sha256('a'.repeat(100)) === '2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e');
  store.factoryReset();
  check('factory unit asks for an admin password', store.needsSetup());
  check('first-login setup logs in', store.setupAdmin('Pw-Setup1') === null && store.getState().auth.loggedIn);
  check('no setup needed once the password is set', !store.needsSetup());
  const adminPw = () => (store.getState().config['system admin'] as { entries: { key: string; f: Record<string, string> }[] }).entries.find((e) => e.key === 'admin')!.f.password;
  check('admin password stored as a hash', isPwHash(adminPw()) && !adminPw().includes('Pw-Setup1'), adminPw());
  const conf = serializeConfig(store.getState().config);
  check('backup holds the hash, not the password', conf.includes(`set password ENC ${adminPw()}`) && !conf.includes(btoa('Pw-Setup1')));
  store.logout();
  check('wrong password refused', store.login('admin', 'nope', 'pc1') === 'Authentication failure');
  store.replaceConfig(parseConfigText(conf), 'restore');
  check('password works after backup/restore', store.login('admin', 'Pw-Setup1', 'pc1') === null);
  run('config system admin', 'edit admin', 'set password Cli-Pw2', 'next', 'end');
  check('password set in the CLI is hashed', isPwHash(adminPw()));
  store.logout();
  check('CLI password works', store.login('admin', 'Cli-Pw2', 'pc1') === null);
  store.logout();
  for (let i = 0; i < 3; i++) store.login('admin', 'bad' + i, 'pc1');
  check('three failures lock PC1 out', store.lockedUntil('pc1') > Date.now() && store.lockedUntil('pc2') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
