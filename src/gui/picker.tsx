import { useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { Config } from '../engine/types';
import { def, entries, list, str, sub } from '../engine/config';
import { vipDesc, vips } from '../engine/views';
import { sdwanConfig } from '../engine/sdwan';
import { Chip, type ChipKind } from './ui';

export interface PickOption {
  name: string;
  group: string;
  kind: ChipKind;
  detail?: string;
}

/** FortiOS-style multi-select: chips in the form, a slide-out "Select Entries" drawer to choose. */
export function EntryPicker({ value, options, onChange, multiple = true, placeholder = 'Click to set' }: { value: string[]; options: PickOption[]; onChange: (v: string[]) => void; multiple?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const kindOf = (n: string) => options.find((o) => o.name === n)?.kind ?? 'addr';
  const groups = useMemo(() => {
    const g: Record<string, PickOption[]> = {};
    for (const o of options) if (!q || o.name.toLowerCase().includes(q.toLowerCase())) (g[o.group] ??= []).push(o);
    return g;
  }, [options, q]);

  const toggle = (n: string) => {
    if (!multiple) {
      onChange([n]);
      setOpen(false);
      return;
    }
    if (value.includes(n)) onChange(value.filter((x) => x !== n));
    // "all"/"any" are exclusive with everything else, as in FortiOS
    else if (n === 'all' || n === 'any' || n === 'ALL') onChange([n]);
    else onChange([...value.filter((x) => x !== 'all' && x !== 'any' && x !== 'ALL'), n]);
  };

  return (
    <>
      <div className="picker" onClick={() => setOpen(true)}>
        {value.map((n) => (
          <div className="pick" key={n}>
            <Chip kind={kindOf(n)} name={n} />
            {multiple && (
              <X
                size={13}
                className="x"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((x) => x !== n));
                }}
              />
            )}
          </div>
        ))}
        {(multiple || value.length === 0) && (
          <div className="add">
            <Plus size={13} /> {value.length ? '' : placeholder}
          </div>
        )}
      </div>
      {open && (
        <>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div className="drawer">
            <div className="drawer-hdr">
              Select Entries
              <span style={{ flex: 1 }} />
              <button className="hdr-btn" style={{ color: 'inherit' }} onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 10 }}>
              <div className="search">
                <Search size={14} />
                <input autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="drawer-body">
              {Object.entries(groups).map(([g, items]) => (
                <div key={g}>
                  <div className="pick-group">
                    {g} ({items.length})
                  </div>
                  {items.map((o) => (
                    <div key={o.name} className={`pick-item ${value.includes(o.name) ? 'on' : ''}`} onClick={() => toggle(o.name)}>
                      <span style={{ width: 14 }}>{value.includes(o.name) && <Check size={14} color="var(--accent)" />}</span>
                      <Chip kind={o.kind} name={o.name} />
                      {o.detail && <span className="detail">{o.detail}</span>}
                    </div>
                  ))}
                </div>
              ))}
              {Object.keys(groups).length === 0 && <div className="empty">No entries</div>}
            </div>
            <div className="drawer-foot">
              <button className="btn primary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------- option builders ----------

export function ifaceOptions(c: Config, opts: { any?: boolean; zones?: boolean; excludeMembers?: boolean } = {}): PickOption[] {
  const I = def('system interface');
  const members = new Set(entries(c, 'system virtual-switch').flatMap((e) => (sub(e.f, 'port')?.entries ?? []).map((p) => p.key)));
  const sw = sdwanConfig(c);
  const zoned = new Set([...entries(c, 'system zone').flatMap((z) => list(def('system zone'), z.f, 'interface')), ...(sw.enabled ? sw.members : [])]);
  const out: PickOption[] = [];
  if (opts.any) out.push({ name: 'any', group: 'Interface', kind: 'any' });
  for (const e of entries(c, 'system interface')) {
    if (members.has(e.key) && opts.excludeMembers !== false) continue;
    if (opts.zones && zoned.has(e.key)) continue;
    const ip = str(I, e.f, 'ip');
    out.push({ name: e.key, group: 'Interface', kind: 'intf', detail: str(I, e.f, 'alias') || (ip !== '0.0.0.0 0.0.0.0' ? ip.split(' ')[0] : '') });
  }
  if (opts.zones) for (const z of entries(c, 'system zone')) out.push({ name: z.key, group: 'Zone', kind: 'zone' });
  if (opts.zones && sw.enabled) for (const z of sw.zones) out.push({ name: z, group: 'SD-WAN Zone', kind: 'zone', detail: sw.members.join(', ') });
  return out;
}

export function addrDetail(c: Config, name: string): string {
  const A = def('firewall address');
  const e = entries(c, 'firewall address').find((x) => x.key === name);
  if (!e) return '';
  const t = str(A, e.f, 'type');
  if (t === 'ipmask') {
    const [ip, mask] = str(A, e.f, 'subnet').split(' ');
    return ip === '0.0.0.0' && mask === '0.0.0.0' ? '0.0.0.0/0' : `${ip}/${mask}`;
  }
  if (t === 'iprange') return `${str(A, e.f, 'start-ip')} - ${str(A, e.f, 'end-ip')}`;
  if (t === 'fqdn') return str(A, e.f, 'fqdn');
  if (t === 'geography') return str(A, e.f, 'country');
  return t;
}

export function addrOptions(c: Config, opts: { vip?: boolean; exclude?: string } = {}): PickOption[] {
  const out: PickOption[] = [];
  for (const e of entries(c, 'firewall address')) if (e.key !== opts.exclude) out.push({ name: e.key, group: 'Address', kind: 'addr', detail: addrDetail(c, e.key) });
  for (const e of entries(c, 'firewall addrgrp')) if (e.key !== opts.exclude) out.push({ name: e.key, group: 'Address Group', kind: 'grp' });
  if (opts.vip) {
    for (const v of vips(c)) out.push({ name: v.name, group: 'Virtual IP', kind: 'vip', detail: vipDesc(v) });
    for (const e of entries(c, 'firewall vipgrp')) out.push({ name: e.key, group: 'Virtual IP Group', kind: 'vip' });
  }
  return out;
}

export function svcDetail(c: Config, name: string): string {
  const S = def('firewall service custom');
  const e = entries(c, 'firewall service custom').find((x) => x.key === name);
  if (!e) return '';
  const p = str(S, e.f, 'protocol');
  if (p === 'IP') return `IP/${str(S, e.f, 'protocol-number') || 'any'}`;
  if (p === 'ICMP') return `ICMP/${str(S, e.f, 'icmptype') || 'any'}`;
  const parts = [...list(S, e.f, 'tcp-portrange').map((r) => `TCP/${r}`), ...list(S, e.f, 'udp-portrange').map((r) => `UDP/${r}`), ...list(S, e.f, 'sctp-portrange').map((r) => `SCTP/${r}`)];
  return parts.join(' ');
}

export function svcOptions(c: Config, exclude?: string): PickOption[] {
  const out: PickOption[] = [];
  for (const e of entries(c, 'firewall service custom')) if (e.key !== exclude) out.push({ name: e.key, group: 'Service', kind: 'svc', detail: svcDetail(c, e.key) });
  for (const e of entries(c, 'firewall service group')) if (e.key !== exclude) out.push({ name: e.key, group: 'Service Group', kind: 'svcgrp' });
  return out;
}

export function schedOptions(c: Config): PickOption[] {
  return [
    ...entries(c, 'firewall schedule recurring').map((e) => ({ name: e.key, group: 'Recurring Schedule', kind: 'sched' as ChipKind })),
    ...entries(c, 'firewall schedule onetime').map((e) => ({ name: e.key, group: 'One-time Schedule', kind: 'sched' as ChipKind })),
    ...entries(c, 'firewall schedule group').map((e) => ({ name: e.key, group: 'Schedule Group', kind: 'sched' as ChipKind })),
  ];
}

export function poolOptions(c: Config): PickOption[] {
  const P = def('firewall ippool');
  return entries(c, 'firewall ippool').map((e) => ({ name: e.key, group: 'IP Pool', kind: 'pool' as ChipKind, detail: `${str(P, e.f, 'startip')} - ${str(P, e.f, 'endip')}` }));
}

export function userOptions(c: Config): PickOption[] {
  return [
    ...entries(c, 'user local').map((e) => ({ name: e.key, group: 'User', kind: 'user' as ChipKind, detail: str(def('user local'), e.f, 'type') })),
    ...entries(c, 'user group').map((e) => ({ name: e.key, group: 'User Group', kind: 'usergrp' as ChipKind })),
  ];
}

export function authServerOptions(c: Config): PickOption[] {
  return [
    ...entries(c, 'user ldap').map((e) => ({ name: e.key, group: 'LDAP Server', kind: 'authsrv' as ChipKind, detail: str(def('user ldap'), e.f, 'server') })),
    ...entries(c, 'user radius').map((e) => ({ name: e.key, group: 'RADIUS Server', kind: 'authsrv' as ChipKind, detail: str(def('user radius'), e.f, 'server') })),
  ];
}

/** Decide the chip icon for a name used in a policy. */
export function kindOfName(c: Config, n: string): ChipKind {
  if (n === 'any' || n === 'all' || n === 'ALL') return 'any';
  if (entries(c, 'system zone').some((e) => e.key === n) || sdwanConfig(c).zones.includes(n)) return 'zone';
  if (entries(c, 'system interface').some((e) => e.key === n)) return 'intf';
  if (entries(c, 'firewall addrgrp').some((e) => e.key === n)) return 'grp';
  if (entries(c, 'firewall vip').some((e) => e.key === n) || entries(c, 'firewall vipgrp').some((e) => e.key === n)) return 'vip';
  if (entries(c, 'firewall service group').some((e) => e.key === n)) return 'svcgrp';
  if (entries(c, 'firewall service custom').some((e) => e.key === n)) return 'svc';
  if (entries(c, 'firewall ippool').some((e) => e.key === n)) return 'pool';
  if (entries(c, 'user group').some((e) => e.key === n)) return 'usergrp';
  if (entries(c, 'user local').some((e) => e.key === n)) return 'user';
  if (entries(c, 'user ldap').some((e) => e.key === n) || entries(c, 'user radius').some((e) => e.key === n)) return 'authsrv';
  return 'addr';
}
