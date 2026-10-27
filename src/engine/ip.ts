export function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export const isIp = (s: string) => ipToInt(s) !== null;

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function prefixToMaskInt(p: number): number {
  return p <= 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
}

export const prefixToMask = (p: number) => intToIp(prefixToMaskInt(p));

export function maskToPrefix(mask: string): number | null {
  const n = ipToInt(mask);
  if (n === null) return null;
  let p = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) {
      if (seenZero) return null;
      p++;
    } else seenZero = true;
  }
  return p;
}

export interface IpNet {
  ip: number;
  prefix: number;
}

/** Accepts "1.2.3.4 255.255.255.0", "1.2.3.4/24", "1.2.3.4/255.255.255.0" or "1.2.3.4" (= /32). */
export function parseIpMask(s: string): IpNet | null {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let ipS = t;
  let maskS: string | undefined;
  if (t.includes('/')) [ipS, maskS] = t.split('/');
  else if (t.includes(' ')) [ipS, maskS] = t.split(' ');
  const ip = ipToInt(ipS);
  if (ip === null) return null;
  let prefix = 32;
  if (maskS !== undefined) {
    if (/^\d{1,2}$/.test(maskS)) {
      prefix = Number(maskS);
      if (prefix > 32) return null;
    } else {
      const p = maskToPrefix(maskS);
      if (p === null) return null;
      prefix = p;
    }
  }
  return { ip, prefix };
}

export const fmtIpMask = (n: IpNet) => `${intToIp(n.ip)} ${prefixToMask(n.prefix)}`;
export const fmtCidr = (n: IpNet) => `${intToIp(n.ip)}/${n.prefix}`;
export const netAddr = (ip: number, prefix: number) => (ip & prefixToMaskInt(prefix)) >>> 0;
export const inNet = (ip: number, net: number, prefix: number) => netAddr(ip, prefix) === netAddr(net, prefix);

/** "a.b.c.d" or "a.b.c.d-e.f.g.h" -> [start, end] */
export function parseIpRange(s: string): [number, number] | null {
  const [a, b] = s.trim().split('-');
  const x = ipToInt(a ?? '');
  if (x === null) return null;
  if (b === undefined) return [x, x];
  const y = ipToInt(b);
  if (y === null || y < x) return null;
  return [x, y];
}

/** "80" or "8080-8090" -> [lo, hi] */
export function parsePortRange(s: string): [number, number] | null {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(s.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  if (lo < 1 || hi > 65535 || hi < lo) return null; // ports are 1-65535
  return [lo, hi];
}

export function isPrivate(ip: number): boolean {
  const n = (net: string, p: number) => inNet(ip, ipToInt(net)!, p);
  return n('10.0.0.0', 8) || n('172.16.0.0', 12) || n('192.168.0.0', 16) || n('100.64.0.0', 10) || n('127.0.0.0', 8) || n('169.254.0.0', 16);
}
