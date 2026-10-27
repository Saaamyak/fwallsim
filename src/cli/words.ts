// Word resolution (FortiOS accepts unique abbreviations: "conf sys int", "diag deb flow") and command trees.
import { SCHEMA } from '../engine/schema';

export type Resolved = { word: string } | { error: 'none' | 'ambiguous'; matches: string[] };

export function resolveWord(input: string, candidates: string[]): Resolved {
  if (candidates.includes(input)) return { word: input };
  const m = candidates.filter((c) => c.startsWith(input));
  if (m.length === 1) return { word: m[0] };
  return { error: m.length ? 'ambiguous' : 'none', matches: m };
}

export const isWord = (r: Resolved): r is { word: string } => 'word' in r;

// ---------- config paths ----------

export const PATHS = SCHEMA.map((p) => p.path);

/** Next words available after the given resolved path prefix. */
export function nextPathWords(prefix: string[]): string[] {
  const out = new Set<string>();
  for (const p of PATHS) {
    const w = p.split(' ');
    if (w.length > prefix.length && prefix.every((x, i) => w[i] === x)) out.add(w[prefix.length]);
  }
  return [...out];
}

export interface PathMatch {
  path?: string;
  consumed: string[]; // resolved words
  rest: string[]; // remaining tokens after the path
  error?: string; // token that failed
  ambiguous?: boolean;
}

/** Resolve "fire pol 3" -> path "firewall policy", rest ["3"]. */
export function resolvePath(tokens: string[]): PathMatch {
  const consumed: string[] = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    const full = consumed.join(' ');
    const isLeaf = PATHS.includes(full);
    const next = nextPathWords(consumed);
    if (isLeaf && (!next.length || !next.some((n) => n.startsWith(tokens[i])))) break;
    const r = resolveWord(tokens[i], next);
    if (!isWord(r)) return { consumed, rest: tokens.slice(i), error: tokens[i], ambiguous: r.error === 'ambiguous' };
    consumed.push(r.word);
  }
  const full = consumed.join(' ');
  if (!PATHS.includes(full)) return { consumed, rest: tokens.slice(i), error: tokens[i] ?? consumed[consumed.length - 1] ?? '' };
  return { path: full, consumed, rest: tokens.slice(i) };
}

// ---------- command trees for get / diagnose / execute ----------

export interface CmdNode {
  h: string;
  c?: Record<string, CmdNode>;
  arg?: string; // free arguments follow: describes them
}

const leaf = (h: string, arg?: string): CmdNode => ({ h, arg });

export const DIAG_TREE: CmdNode = {
  h: 'Diagnose facility.',
  c: {
    debug: {
      h: 'Debug.',
      c: {
        enable: leaf('Enable debug output.'),
        disable: leaf('Disable debug output.'),
        reset: leaf('Reset all debug level to default.'),
        application: { h: 'Set/Get application debug level.', c: { ike: leaf('IKE daemon (-1 = all messages, 0 = off).', '<level>') } },
        info: leaf('Show active debug level settings.'),
        flow: {
          h: 'Trace packet flow in kernel.',
          c: {
            filter: {
              h: 'Set flow filter.',
              c: {
                addr: leaf('IP address (source or destination).', '<ip>'),
                saddr: leaf('Source IP address.', '<ip>'),
                daddr: leaf('Destination IP address.', '<ip>'),
                port: leaf('Port (source or destination).', '<port>'),
                sport: leaf('Source port.', '<port>'),
                dport: leaf('Destination port.', '<port>'),
                proto: leaf('Protocol number (1 icmp, 6 tcp, 17 udp).', '<proto>'),
                clear: leaf('Clear filter.'),
              },
            },
            show: { h: 'Show trace detail.', c: { 'function-name': { h: 'Show function name.', c: { enable: leaf('Enable.'), disable: leaf('Disable.') } } } },
            trace: { h: 'Trace flow.', c: { start: leaf('Start trace.', '<count>'), stop: leaf('Stop trace.') } },
          },
        },
      },
    },
    sys: {
      h: 'System diagnostics.',
      c: {
        session: {
          h: 'Session.',
          c: {
            list: leaf('List sessions.'),
            filter: {
              h: 'Set session filter.',
              c: {
                src: leaf('Source IP.', '<ip>'),
                dst: leaf('Destination IP.', '<ip>'),
                sport: leaf('Source port.', '<port>'),
                dport: leaf('Destination port.', '<port>'),
                proto: leaf('Protocol number.', '<proto>'),
                policy: leaf('Policy ID.', '<id>'),
                clear: leaf('Clear session filter.'),
              },
            },
            clear: leaf('Clear sessions that match the filter.'),
            stat: leaf('Show session statistics.'),
          },
        },
        sdwan: { h: 'SD-WAN.', c: { 'health-check': leaf('Show health-check (Performance SLA) status.'), member: leaf('Show SD-WAN members.'), service: leaf('Show SD-WAN rules and selected members.') } },
      },
    },
    vpn: {
      h: 'VPN diagnostics.',
      c: {
        tunnel: { h: 'IPsec tunnel.', c: { list: leaf('List all IPsec tunnels.'), up: leaf('Bring a tunnel up.', '<phase2-name>'), down: leaf('Bring a tunnel down.', '<phase2-name>') } },
        ike: { h: 'IKE.', c: { gateway: { h: 'IKE gateways.', c: { list: leaf('List IKE gateways.') } } } },
      },
    },
    sniffer: { h: 'Sniffer.', c: { packet: leaf('Sniff packets.', "<interface> ['<filter>'] [verbose 1-6] [count] [tsformat a|l]") } },
    ip: { h: 'IP diagnostics.', c: { arp: { h: 'ARP.', c: { list: leaf('List ARP table.') } } } },
    firewall: {
      h: 'Firewall diagnostics.',
      c: {
        iprope: { h: 'Policy table.', c: { lookup: leaf('Look up the matching policy.', '<src_ip> <src_port> <dst_ip> <dst_port> <protocol> <dev>') } },
        auth: { h: 'Authenticated users.', c: { list: leaf('List authenticated users.'), clear: leaf('Clear all authenticated users.') } },
      },
    },
    test: {
      h: 'Test tools.',
      c: { authserver: { h: 'Test an authentication server.', c: { ldap: leaf('Test LDAP server.', '<server> <user> <password>'), radius: leaf('Test RADIUS server.', '<server> <scheme> <user> <password>') } } },
    },
    hardware: { h: 'Hardware diagnostics.', c: { deviceinfo: { h: 'Device information.', c: { nic: leaf('NIC information.', '<interface>') } } } },
  },
};

export const EXEC_TREE: CmdNode = {
  h: 'Execute static commands.',
  c: {
    ping: leaf('Send ICMP echo requests from the FortiGate.', '<host>'),
    traceroute: leaf('Trace the route to a host.', '<host>'),
    backup: { h: 'Backup configuration.', c: { config: leaf('Backup config file.', 'tftp <filename> <server>') } },
    date: leaf('Get or set the system date.'),
    time: leaf('Get or set the system time.'),
    dhcp: { h: 'DHCP.', c: { 'lease-list': leaf('Show DHCP leases.') } },
    reboot: leaf('Reboot the system.'),
    factoryreset: leaf('Reset to factory default.'),
  },
};

/** Special (non-config) "get" commands; config paths are merged in at runtime. */
export const GET_TREE: CmdNode = {
  h: 'Get dynamic and system information.',
  c: {
    system: {
      h: 'System.',
      c: {
        status: leaf('System status.'),
        performance: { h: 'Performance.', c: { status: leaf('System performance status.') } },
        interface: { h: 'Interface.', c: { physical: leaf('Physical interface status.') } },
        arp: leaf('ARP table.'),
        session: { h: 'Session.', c: { list: leaf('List sessions.') } },
        ha: { h: 'HA.', c: { status: leaf('HA status.') } },
      },
    },
    vpn: {
      h: 'VPN.',
      c: {
        ipsec: { h: 'IPsec.', c: { tunnel: { h: 'Tunnels.', c: { summary: leaf('Tunnel summary.') } } } },
        ssl: { h: 'SSL-VPN.', c: { monitor: leaf('SSL-VPN users and sessions.') } },
      },
    },
    router: {
      h: 'Router.',
      c: {
        info: {
          h: 'Routing information.',
          c: {
            'routing-table': { h: 'Routing table.', c: { all: leaf('All active routes.'), database: leaf('Routing table database (active and inactive).'), details: leaf('Route lookup details.', '[<ip>]') } },
            bgp: { h: 'BGP information.', c: { summary: leaf('BGP neighbor summary.'), neighbors: leaf('BGP neighbor details.'), network: leaf('BGP routing table.') } },
            ospf: { h: 'OSPF information.', c: { neighbor: leaf('OSPF neighbors.'), interface: leaf('OSPF interfaces.'), status: leaf('OSPF process status.') } },
          },
        },
      },
    },
  },
};

export interface TreeWalk {
  node: CmdNode;
  words: string[]; // resolved
  rest: string[]; // args after a leaf
  error?: string;
  ambiguous?: boolean;
}

export function walkTree(root: CmdNode, tokens: string[]): TreeWalk {
  let node = root;
  const words: string[] = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    if (!node.c) break;
    const r = resolveWord(tokens[i], Object.keys(node.c));
    if (!isWord(r)) return { node, words, rest: tokens.slice(i), error: tokens[i], ambiguous: r.error === 'ambiguous' };
    words.push(r.word);
    node = node.c[r.word];
  }
  return { node, words, rest: tokens.slice(i) };
}
