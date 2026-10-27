import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast, updateConfig, useStore } from '../../store';
import type { Config, ConfigTable, Fields } from '../../engine/types';
import { def, findRefs, list, str, sub } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { isIp } from '../../engine/ip';
import { ISPS } from '../../engine/topology';
import { Field, Seg, Toggle } from '../ui';
import { addrOptions, EntryPicker, ifaceOptions } from '../picker';

interface Member {
  seq: string;
  intf: string;
  zone: string;
  gateway: string;
  priority: string;
  cost: string;
  enabled: boolean;
}
interface Hc {
  name: string;
  server: string;
  protocol: string;
  members: string[];
  sla: { latency: string; jitter: string; loss: string }[];
}
interface Rule {
  name: string;
  mode: string;
  dst: string[];
  src: string[];
  protocol: string;
  sp: string;
  ep: string;
  order: string[];
  hc: string;
  slaId: string;
  enabled: boolean;
}
interface Model {
  status: boolean;
  zones: string[];
  members: Member[];
  hcs: Hc[];
  rules: Rule[];
}

const D = () => def('system sdwan');
const sd = (n: string) => D().fields.find((x) => x.name === n)!.sub!;

function load(c: Config): Model {
  const f = c['system sdwan']?.kind === 'object' ? c['system sdwan'].f : {};
  const M = sd('members');
  const H = sd('health-check');
  const HS = H.fields.find((x) => x.name === 'sla')!.sub!;
  const S = sd('service');
  const SS = S.fields.find((x) => x.name === 'sla')!.sub!;
  return {
    status: str(D(), f, 'status') === 'enable',
    zones: (sub(f, 'zone')?.entries ?? []).map((z) => z.key),
    members: (sub(f, 'members')?.entries ?? []).map((e) => ({ seq: e.key, intf: str(M, e.f, 'interface'), zone: str(M, e.f, 'zone'), gateway: str(M, e.f, 'gateway'), priority: str(M, e.f, 'priority'), cost: str(M, e.f, 'cost'), enabled: str(M, e.f, 'status') === 'enable' })),
    hcs: (sub(f, 'health-check')?.entries ?? []).map((e) => ({
      name: e.key,
      server: list(H, e.f, 'server').join(' '),
      protocol: str(H, e.f, 'protocol'),
      members: list(H, e.f, 'members'),
      sla: (sub(e.f, 'sla')?.entries ?? []).map((t) => ({ latency: str(HS, t.f, 'latency-threshold'), jitter: str(HS, t.f, 'jitter-threshold'), loss: str(HS, t.f, 'packetloss-threshold') })),
    })),
    rules: (sub(f, 'service')?.entries ?? []).map((e) => {
      const hc = list(S, e.f, 'health-check')[0] ?? '';
      const slaE = (sub(e.f, 'sla')?.entries ?? []).find((x) => x.key === hc);
      return { name: str(S, e.f, 'name'), mode: str(S, e.f, 'mode'), dst: list(S, e.f, 'dst'), src: list(S, e.f, 'src'), protocol: str(S, e.f, 'protocol'), sp: str(S, e.f, 'start-port'), ep: str(S, e.f, 'end-port'), order: list(S, e.f, 'priority-members'), hc, slaId: slaE ? str(SS, slaE.f, 'id') : '1', enabled: str(S, e.f, 'status') === 'enable' };
    }),
  };
}

const T = (entries: { key: string; f: Fields }[]): ConfigTable => ({ kind: 'table', entries });

function toFields(m: Model): Fields {
  return {
    status: m.status ? 'enable' : 'disable',
    zone: T((m.zones.length ? m.zones : ['virtual-wan-link']).map((z) => ({ key: z, f: {} }))),
    members: T(
      m.members.map((x) => ({
        key: x.seq,
        f: { interface: x.intf, ...(x.zone !== 'virtual-wan-link' ? { zone: x.zone } : {}), ...(x.gateway && x.gateway !== '0.0.0.0' ? { gateway: x.gateway } : {}), ...(x.priority !== '1' ? { priority: x.priority } : {}), ...(x.cost !== '0' ? { cost: x.cost } : {}), ...(!x.enabled ? { status: 'disable' } : {}) },
      })),
    ),
    'health-check': T(
      m.hcs.map((h) => ({
        key: h.name,
        f: {
          server: h.server.split(/\s+/).filter(Boolean),
          ...(h.protocol !== 'ping' ? { protocol: h.protocol } : {}),
          ...(h.members.length ? { members: h.members } : {}),
          sla: T(h.sla.map((t, i) => ({ key: String(i + 1), f: { 'latency-threshold': t.latency, 'jitter-threshold': t.jitter, 'packetloss-threshold': t.loss } }))),
        },
      })),
    ),
    service: T(
      m.rules.map((r, i) => ({
        key: String(i + 1),
        f: {
          name: r.name,
          ...(r.mode !== 'manual' ? { mode: r.mode } : {}),
          ...(r.dst.length ? { dst: r.dst } : {}),
          ...(r.src.length ? { src: r.src } : {}),
          ...(r.protocol !== '0' ? { protocol: r.protocol } : {}),
          ...(r.sp !== '1' ? { 'start-port': r.sp } : {}),
          ...(r.ep !== '65535' ? { 'end-port': r.ep } : {}),
          ...(r.order.length ? { 'priority-members': r.order } : {}),
          ...(r.mode !== 'manual' && r.hc ? { 'health-check': [r.hc], sla: T(r.mode === 'sla' ? [{ key: r.hc, f: { id: r.slaId } }] : []) } : {}),
          ...(!r.enabled ? { status: 'disable' } : {}),
        },
      })),
    ),
  };
}

export function SdWanPage() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const [m, setM] = useState<Model>(() => load(config));
  const [tab, setTab] = useState<'zones' | 'sla' | 'rules'>('zones');
  const [err, setErr] = useState('');
  const set = (patch: Partial<Model>) => setM({ ...m, ...patch });
  const memberOpts = ifaceOptions(config).filter((o) => o.name !== 'ssl.root' && !m.members.some((x) => x.intf === o.name));
  const live = (seq: string) => net.sdwan.members.find((x) => x.seq === seq);

  const apply = () => {
    setErr('');
    for (const x of m.members) if (x.gateway && x.gateway !== '0.0.0.0' && !isIp(x.gateway)) return setErr(`Member ${x.intf}: invalid gateway.`);
    // FortiOS refuses to add an interface that policies or routes already use directly.
    const before = load(config).members.map((x) => x.intf);
    for (const x of m.members.filter((y) => !before.includes(y.intf))) {
      const used = findRefs(config, 'system interface', x.intf).filter((r) => r.path === 'firewall policy' || r.path === 'router static');
      if (used.length) return setErr(`${x.intf} is used by ${used.map((u) => `${u.path} ${u.key}`).join(', ')}. Change those to the SD-WAN zone (or delete them) first, as on a real FortiGate.`);
    }
    const n = (v: string, lo: number, hi: number) => /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;
    for (const x of m.members) if (!n(x.priority || '1', 1, 65535) || !n(x.cost || '0', 0, 4294967295)) return setErr(`Member ${x.intf}: priority must be 1–65535 and cost 0–4294967295.`);
    for (const h of m.hcs) if (!h.name || !h.server.trim()) return setErr('Each Performance SLA needs a name and a server.');
    if (new Set(m.hcs.map((h) => h.name)).size !== m.hcs.length) return setErr('Each Performance SLA needs a unique name.');
    for (const h of m.hcs) for (const s of h.sla) if (!n(s.latency || '0', 0, 10000000) || !n(s.jitter || '0', 0, 10000000) || !n(s.loss || '0', 0, 100)) return setErr(`SLA "${h.name}": latency and jitter are milliseconds, packet loss is 0–100 %.`);
    if (new Set(m.rules.map((r) => r.name)).size !== m.rules.length) return setErr('Each SD-WAN rule needs a unique name.');
    for (const r of m.rules) if ((r.sp && !n(r.sp, 0, 65535)) || (r.ep && !n(r.ep, 0, 65535)) || (r.sp && r.ep && Number(r.sp) > Number(r.ep))) return setErr(`Rule "${r.name}": invalid port range.`);
    for (const r of m.rules) if (!r.name) return setErr('Each SD-WAN rule needs a name.');
    updateConfig((c) => {
      c['system sdwan'] = { kind: 'object', f: toFields(m) };
    }, 'Edit system.sdwan');
    toast('SD-WAN settings applied');
  };

  const addMember = (intf: string) => {
    const seq = String(m.members.reduce((x, y) => Math.max(x, Number(y.seq)), 0) + 1);
    set({ members: [...m.members, { seq, intf, zone: m.zones[0] ?? 'virtual-wan-link', gateway: ISPS[intf]?.ip ?? '0.0.0.0', priority: '1', cost: '0', enabled: true }] });
  };

  return (
    <div className="page">
      <div className="page-title">SD-WAN</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: 'zones', label: 'SD-WAN Zones' },
            { v: 'sla', label: 'Performance SLAs' },
            { v: 'rules', label: 'SD-WAN Rules' },
          ]}
        />
        <Toggle on={m.status} onChange={(v) => set({ status: v })} label={<b>SD-WAN {m.status ? 'enabled' : 'disabled'}</b>} />
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={apply}>
          Apply
        </button>
      </div>
      {err && <p className="err-text">{err}</p>}

      {tab === 'zones' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Interface</th>
                <th>Zone</th>
                <th>Gateway</th>
                <th>Cost</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Health</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.members.map((x, i) => {
                const lv = live(x.seq);
                const upd = (p: Partial<Member>) => set({ members: m.members.map((y, j) => (j === i ? { ...y, ...p } : y)) });
                return (
                  <tr className="row" key={x.seq}>
                    <td>{x.seq}</td>
                    <td>
                      <b>{x.intf}</b>
                    </td>
                    <td>{x.zone}</td>
                    <td>
                      <input className="inp md" value={x.gateway} onChange={(e) => upd({ gateway: e.target.value })} />
                    </td>
                    <td>
                      <input className="inp" style={{ width: 60 }} value={x.cost} onChange={(e) => upd({ cost: e.target.value })} />
                    </td>
                    <td>
                      <input className="inp" style={{ width: 60 }} value={x.priority} onChange={(e) => upd({ priority: e.target.value })} />
                    </td>
                    <td>
                      <Toggle on={x.enabled} onChange={(v) => upd({ enabled: v })} />
                    </td>
                    <td>{!lv ? <span className="muted">(apply)</span> : lv.alive ? <span className="badge ok">Alive</span> : <span className="badge err">{lv.up ? 'Dead (health check)' : 'Link down'}</span>}</td>
                    <td>
                      <button className="btn sm" onClick={() => set({ members: m.members.filter((_, j) => j !== i) })}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="sel md" value="" onChange={(e) => e.target.value && addMember(e.target.value)}>
              <option value="">+ Add SD-WAN member…</option>
              {memberOpts.map((o) => (
                <option key={o.name}>{o.name}</option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Zone: virtual-wan-link. Then point a static route at the zone (Network &gt; Static Routes, Interface = virtual-wan-link) and use the zone in firewall policies.
            </span>
          </div>
        </div>
      )}

      {tab === 'sla' && (
        <>
          {m.hcs.map((h, i) => {
            const lv = net.sdwan.health.find((x) => x.name === h.name);
            const upd = (p: Partial<Hc>) => set({ hcs: m.hcs.map((y, j) => (j === i ? { ...y, ...p } : y)) });
            return (
              <div key={i} className="form-card" style={{ marginBottom: 12, maxWidth: 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <b>Performance SLA</b>
                  <input className="inp md" value={h.name} onChange={(e) => upd({ name: e.target.value })} />
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" onClick={() => set({ hcs: m.hcs.filter((_, j) => j !== i) })}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
                <Field label="Protocol">
                  <Seg
                    value={h.protocol}
                    onChange={(v) => upd({ protocol: v })}
                    options={[
                      { v: 'ping', label: 'Ping' },
                      { v: 'http', label: 'HTTP' },
                      { v: 'dns', label: 'DNS' },
                    ]}
                  />
                </Field>
                <Field label="Server" help="An address on the internet beyond the ISP, e.g. 8.8.8.8. Pinging the ISP gateway would not detect an upstream outage.">
                  <input className="inp" value={h.server} onChange={(e) => upd({ server: e.target.value })} />
                </Field>
                <Field label="Participants">
                  <div className="checks">
                    {m.members.map((x) => (
                      <label key={x.seq}>
                        <input type="checkbox" checked={!h.members.length || h.members.includes(x.seq)} onChange={(e) => upd({ members: e.target.checked ? [...(h.members.length ? h.members : []), x.seq] : (h.members.length ? h.members : m.members.map((y) => y.seq)).filter((q) => q !== x.seq) })} />
                        {x.intf}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="SLA Targets">
                  {h.sla.map((t, k) => (
                    <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                      <span className="muted">#{k + 1} latency ≤</span>
                      <input className="inp" style={{ width: 55 }} value={t.latency} onChange={(e) => upd({ sla: h.sla.map((x, j) => (j === k ? { ...x, latency: e.target.value } : x)) })} />
                      <span className="muted">ms, jitter ≤</span>
                      <input className="inp" style={{ width: 55 }} value={t.jitter} onChange={(e) => upd({ sla: h.sla.map((x, j) => (j === k ? { ...x, jitter: e.target.value } : x)) })} />
                      <span className="muted">ms, loss ≤</span>
                      <input className="inp" style={{ width: 55 }} value={t.loss} onChange={(e) => upd({ sla: h.sla.map((x, j) => (j === k ? { ...x, loss: e.target.value } : x)) })} />
                      <span className="muted">%</span>
                      <button className="btn sm" onClick={() => upd({ sla: h.sla.filter((_, j) => j !== k) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button className="btn sm" onClick={() => upd({ sla: [...h.sla, { latency: '5', jitter: '5', loss: '0' }] })}>
                    <Plus size={12} /> Add SLA target
                  </button>
                </Field>
                {lv && (
                  <div className="tbl-wrap" style={{ marginTop: 6 }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Status</th>
                          <th className="num">Latency</th>
                          <th className="num">Jitter</th>
                          <th className="num">Packet loss</th>
                          <th>SLA targets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lv.members.map((x) => (
                          <tr className="row" key={x.seq}>
                            <td>{x.intf}</td>
                            <td>{x.alive ? <span className="badge ok">Alive</span> : <span className="badge err">Dead</span>}</td>
                            <td className="num">{x.alive ? `${x.latency} ms` : '-'}</td>
                            <td className="num">{x.alive ? `${x.jitter} ms` : '-'}</td>
                            <td className="num">{x.loss}%</td>
                            <td>{x.sla.map((ok, k) => <span key={k} className={`badge ${ok ? 'ok' : 'err'}`} style={{ marginRight: 4 }}>#{k + 1} {ok ? 'met' : 'failed'}</span>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn" onClick={() => set({ hcs: [...m.hcs, { name: m.hcs.length ? `SLA-${m.hcs.length + 1}` : 'Google', server: '8.8.8.8', protocol: 'ping', members: [], sla: [{ latency: '5', jitter: '5', loss: '0' }] }] })}>
            <Plus size={14} /> Create New Performance SLA
          </button>
        </>
      )}

      {tab === 'rules' && (
        <>
          {m.rules.map((r, i) => {
            const upd = (p: Partial<Rule>) => set({ rules: m.rules.map((y, j) => (j === i ? { ...y, ...p } : y)) });
            const order = r.order.length ? r.order : m.members.map((x) => x.seq);
            const hc = m.hcs.find((h) => h.name === r.hc);
            const move = (k: number, d: -1 | 1) => {
              const o = [...order];
              [o[k], o[k + d]] = [o[k + d], o[k]];
              upd({ order: o });
            };
            return (
              <div key={i} className="form-card" style={{ marginBottom: 12, maxWidth: 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <b>Rule {i + 1}</b>
                  <input className="inp md" value={r.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Name" />
                  <Toggle on={r.enabled} onChange={(v) => upd({ enabled: v })} label="Enabled" />
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" disabled={i === 0} onClick={() => set({ rules: m.rules.map((y, j) => (j === i - 1 ? r : j === i ? m.rules[i - 1] : y)) })}>
                    <ArrowUp size={12} />
                  </button>
                  <button className="btn sm" onClick={() => set({ rules: m.rules.filter((_, j) => j !== i) })}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
                <Field label="Destination">
                  <EntryPicker value={r.dst} options={addrOptions(config)} onChange={(v) => upd({ dst: v })} placeholder="all" />
                </Field>
                <Field label="Source">
                  <EntryPicker value={r.src} options={addrOptions(config)} onChange={(v) => upd({ src: v })} placeholder="any" />
                </Field>
                <Field label="Protocol / ports" help="0 = any protocol">
                  <input className="inp" style={{ width: 55 }} value={r.protocol} onChange={(e) => upd({ protocol: e.target.value })} /> <input className="inp" style={{ width: 70 }} value={r.sp} onChange={(e) => upd({ sp: e.target.value })} /> - <input className="inp" style={{ width: 70 }} value={r.ep} onChange={(e) => upd({ ep: e.target.value })} />
                </Field>
                <Field label="Outgoing interfaces">
                  <Seg
                    value={r.mode}
                    onChange={(v) => upd({ mode: v })}
                    options={[
                      { v: 'manual', label: 'Manual' },
                      { v: 'priority', label: 'Best Quality' },
                      { v: 'sla', label: 'Lowest Cost (SLA)' },
                    ]}
                  />
                  <div style={{ marginTop: 6 }}>
                    {order.map((q, k) => {
                      const mem = m.members.find((x) => x.seq === q);
                      const lv = live(q);
                      return (
                        <div key={q} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                          <span className="muted">{k + 1}.</span>
                          <b style={{ width: 70 }}>{mem?.intf ?? q}</b>
                          {lv && (lv.alive ? <span className="badge ok">alive</span> : <span className="badge err">dead</span>)}
                          <button className="btn sm" disabled={k === 0} onClick={() => move(k, -1)}>
                            <ArrowUp size={12} />
                          </button>
                          <button className="btn sm" disabled={k === order.length - 1} onClick={() => move(k, 1)}>
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </Field>
                {r.mode !== 'manual' && (
                  <Field label="Performance SLA">
                    <select className="sel md" value={r.hc} onChange={(e) => upd({ hc: e.target.value })}>
                      <option value="">Select…</option>
                      {m.hcs.map((h) => (
                        <option key={h.name}>{h.name}</option>
                      ))}
                    </select>
                    {r.mode === 'sla' && hc && (
                      <select className="sel sm" style={{ marginLeft: 6 }} value={r.slaId} onChange={(e) => upd({ slaId: e.target.value })}>
                        {hc.sla.map((_, k) => (
                          <option key={k} value={String(k + 1)}>
                            SLA target #{k + 1}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
              </div>
            );
          })}
          <button className="btn" onClick={() => set({ rules: [...m.rules, { name: `rule${m.rules.length + 1}`, mode: 'manual', dst: [], src: [], protocol: '0', sp: '1', ep: '65535', order: m.members.map((x) => x.seq), hc: m.hcs[0]?.name ?? '', slaId: '1', enabled: true }] })}>
            <Plus size={14} /> Create New SD-WAN Rule
          </button>
          <p className="muted" style={{ marginTop: 10 }}>
            Rules are checked top to bottom after policy routes. Traffic that matches no rule uses the <b>implicit rule</b>: the routing table, load-balanced by source IP over the live members.
          </p>
        </>
      )}
    </div>
  );
}
