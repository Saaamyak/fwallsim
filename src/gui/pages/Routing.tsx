import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { navigate, toast, updateConfig, useStore } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, list, objectOf, str, sub } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { fmtIpMask, intToIp, isIp, parseIpMask } from '../../engine/ip';
import { BRANCH_OSPF, ISP_BGP } from '../../engine/dynroute';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Section, Seg } from '../ui';
import { ifaceOptions } from '../picker';

const cidr = (s: string) => {
  const n = parseIpMask(s);
  return n ? `${intToIp(n.ip)}/${n.prefix}` : s;
};

// ---------- Policy Routes ----------

interface PRow {
  key: string;
  inDev: string[];
  src: string[];
  dst: string[];
  proto: string;
  ports: string;
  out: string;
  gw: string;
  action: string;
  status: boolean;
}

export function PolicyRoutesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <PolicyRouteEdit id={editKey} /> : <PolicyRouteList />;
}

function PolicyRouteList() {
  const config = useStore((s) => s.config);
  const P = def('router policy');
  const rows: PRow[] = entries(config, 'router policy').map((e) => {
    const s = (n: string) => str(P, e.f, n);
    const sp = s('start-port');
    const ep = s('end-port');
    return { key: e.key, inDev: list(P, e.f, 'input-device'), src: list(P, e.f, 'src').map(cidr), dst: list(P, e.f, 'dst').map(cidr), proto: s('protocol') === '0' ? 'ANY' : s('protocol'), ports: sp === '1' && ep === '65535' ? 'any' : sp === ep ? sp : `${sp}-${ep}`, out: s('output-device'), gw: s('gateway'), action: s('action'), status: s('status') === 'enable' };
  });
  const cols: Col<PRow>[] = [
    { title: 'Seq.#', render: (r) => r.key },
    { title: 'Incoming', render: (r) => r.inDev.join(', ') || 'any' },
    { title: 'Source', render: (r) => <span className="mono">{r.src.join(', ') || 'all'}</span> },
    { title: 'Destination', render: (r) => <span className="mono">{r.dst.join(', ') || 'all'}</span> },
    { title: 'Protocol / Port', render: (r) => `${r.proto} / ${r.ports}` },
    { title: 'Action', render: (r) => (r.action === 'deny' ? <span className="badge warn">Stop policy routing</span> : <span>→ {r.out}{r.gw !== '0.0.0.0' ? ` via ${r.gw}` : ''}</span>) },
    { title: 'Status', render: (r) => (r.status ? <span className="badge ok">Enabled</span> : <span className="badge grey">Disabled</span>) },
  ];
  return (
    <div className="page">
      <div className="page-title">Policy Routes</div>
      <ObjectList
        groups={[{ title: '', rows }]}
        cols={cols}
        onCreate={() => navigate('net-pbr', 'new')}
        onEdit={(r) => navigate('net-pbr', r.key)}
        onDelete={(r) => updateConfig((c) => (tableOf(c).entries = entries(c, 'router policy').filter((e) => e.key !== r.key)), `Delete router.policy ${r.key}`)}
        rowClass={(r) => (r.status ? '' : 'disabled')}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Policy routes are checked <b>before</b> the routing table, top to bottom. They route by source, protocol or port, not only by destination. "Stop policy routing" sends matching traffic back to the normal routing table. A policy route whose outgoing interface is down is skipped.
      </p>
    </div>
  );
}

const tableOf = (c: Parameters<typeof entries>[0]) => {
  const t = c['router policy'];
  if (t && t.kind === 'table') return t;
  const n = { kind: 'table' as const, entries: [] };
  c['router policy'] = n;
  return n;
};

function PolicyRouteEdit({ id }: { id: string }) {
  const config = useStore((s) => s.config);
  const isNew = id === 'new';
  const P = def('router policy');
  const e = isNew ? undefined : find(config, 'router policy', id);
  const s = (n: string) => (e ? str(P, e.f, n) : (P.fields.find((x) => x.name === n)?.default as string) ?? '');
  const [f, setF] = useState({
    inDev: e ? list(P, e.f, 'input-device') : ['internal'],
    src: e ? list(P, e.f, 'src').map(cidr).join(', ') : '',
    dst: e ? list(P, e.f, 'dst').map(cidr).join(', ') : '',
    proto: s('protocol'),
    sp: s('start-port'),
    ep: s('end-port'),
    action: s('action'),
    out: s('output-device') || 'wan1',
    gw: s('gateway'),
    status: s('status'),
    comments: s('comments'),
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const intfs = ifaceOptions(config).filter((o) => o.name !== 'ssl.root');

  const save = () => {
    const nets = (t: string) => t.split(/[,\s]+/).filter(Boolean);
    for (const n of [...nets(f.src), ...nets(f.dst)]) if (!parseIpMask(n)) return setErr(`Invalid subnet "${n}".`);
    if (f.action === 'permit' && f.gw !== '0.0.0.0' && !isIp(f.gw)) return setErr('Enter a valid gateway address.');
    const key = isNew ? String(entries(config, 'router policy').reduce((m, x) => Math.max(m, Number(x.key)), 0) + 1) : id;
    const fields: Fields = {};
    if (f.inDev.length) fields['input-device'] = f.inDev;
    if (nets(f.src).length) fields.src = nets(f.src).map((n) => fmtIpMask(parseIpMask(n)!).replace(' ', '/'));
    if (nets(f.dst).length) fields.dst = nets(f.dst).map((n) => fmtIpMask(parseIpMask(n)!).replace(' ', '/'));
    if (f.proto !== '0') fields.protocol = f.proto;
    if (f.sp !== '1') fields['start-port'] = f.sp;
    if (f.ep !== '65535') fields['end-port'] = f.ep;
    if (f.action === 'deny') fields.action = 'deny';
    else {
      fields['output-device'] = f.out;
      if (f.gw && f.gw !== '0.0.0.0') fields.gateway = f.gw;
    }
    if (f.status !== 'enable') fields.status = 'disable';
    if (f.comments) fields.comments = f.comments;
    updateConfig(
      (c) => {
        const t = tableOf(c);
        const row = t.entries.find((x) => x.key === key);
        if (row) row.f = fields;
        else t.entries.push({ key, f: fields });
      },
      `${isNew ? 'Add' : 'Edit'} router.policy ${key}`,
    );
    toast('Policy route saved');
    navigate('net-pbr');
  };

  return (
    <EditPage title={isNew ? 'New Policy Route' : `Edit Policy Route ${id}`} onOk={save} onCancel={() => navigate('net-pbr')}>
      {err && <p className="err-text">{err}</p>}
      <Section title="If incoming traffic matches:">
        <Field label="Incoming interface">
          <select className="sel" value={f.inDev[0] ?? ''} onChange={(e) => up('inDev', e.target.value ? [e.target.value] : [])}>
            <option value="">(any)</option>
            {intfs.map((o) => (
              <option key={o.name}>{o.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Source address" help="Comma-separated subnets, e.g. 192.168.1.111/32. Empty = any.">
          <input className="inp" value={f.src} onChange={(e) => up('src', e.target.value)} />
        </Field>
        <Field label="Destination address" help="Empty = any.">
          <input className="inp" value={f.dst} onChange={(e) => up('dst', e.target.value)} />
        </Field>
        <Field label="Protocol" help="0 = any, 6 = TCP, 17 = UDP, 1 = ICMP">
          <input className="inp sm" value={f.proto} onChange={(e) => up('proto', e.target.value)} />
        </Field>
        <Field label="Destination ports">
          <input className="inp sm" value={f.sp} onChange={(e) => up('sp', e.target.value)} /> - <input className="inp sm" value={f.ep} onChange={(e) => up('ep', e.target.value)} />
        </Field>
      </Section>
      <Section title="Then:">
        <Field label="Action">
          <Seg
            value={f.action}
            onChange={(v) => up('action', v)}
            options={[
              { v: 'permit', label: 'Forward Traffic' },
              { v: 'deny', label: 'Stop Policy Routing' },
            ]}
          />
        </Field>
        {f.action === 'permit' && (
          <>
            <Field label="Outgoing interface">
              <select className="sel" value={f.out} onChange={(e) => up('out', e.target.value)}>
                {intfs.map((o) => (
                  <option key={o.name}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Gateway address" help="Next hop on the outgoing interface (0.0.0.0 for point-to-point tunnels).">
              <input className="inp" value={f.gw} onChange={(e) => up('gw', e.target.value)} />
            </Field>
          </>
        )}
      </Section>
      <Field label="Comments">
        <textarea className="inp" value={f.comments} onChange={(e) => up('comments', e.target.value)} />
      </Field>
      <Field label="Status">
        <Seg
          value={f.status}
          onChange={(v) => up('status', v)}
          options={[
            { v: 'enable', label: 'Enabled' },
            { v: 'disable', label: 'Disabled' },
          ]}
        />
      </Field>
    </EditPage>
  );
}

// ---------- BGP ----------

export function BgpPage() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const B = def('router bgp');
  const N = B.fields.find((x) => x.name === 'neighbor')!.sub!;
  const NW = B.fields.find((x) => x.name === 'network')!.sub!;
  const o = config['router bgp']?.kind === 'object' ? config['router bgp'].f : {};
  const [as, setAs] = useState(str(B, o, 'as'));
  const [rid, setRid] = useState(str(B, o, 'router-id'));
  const [nbs, setNbs] = useState((sub(o, 'neighbor')?.entries ?? []).map((e) => ({ ip: e.key, as: str(N, e.f, 'remote-as') })));
  const [nets, setNets] = useState((sub(o, 'network')?.entries ?? []).map((e) => cidr(str(NW, e.f, 'prefix'))));

  const apply = () => {
    if (!/^\d+$/.test(as)) return toast('Local AS must be a number (0 disables BGP).', 'err');
    if (rid && !isIp(rid)) return toast('Router ID must be an IP address.', 'err');
    if (Number(as) > 4294967295) return toast('Local AS must be 0–4294967295.', 'err');
    if (nbs.some((n) => !isIp(n.ip) || !/^\d+$/.test(n.as) || Number(n.as) < 1 || Number(n.as) > 4294967295)) return toast('Each neighbor needs an IP and a remote AS (1–4294967295).', 'err');
    if (new Set(nbs.map((n) => n.ip)).size !== nbs.length) return toast('Each neighbor IP can only be listed once.', 'err');
    if (nets.some((n) => !parseIpMask(n))) return toast('Invalid network prefix.', 'err');
    updateConfig((c) => {
      const f = objectOf(c, 'router bgp').f;
      f.as = as;
      if (rid && rid !== '0.0.0.0') f['router-id'] = rid;
      else delete f['router-id'];
      f.neighbor = { kind: 'table', entries: nbs.map((n) => ({ key: n.ip, f: { 'remote-as': n.as } })) };
      f.network = { kind: 'table', entries: nets.map((n, i) => ({ key: String(i + 1), f: { prefix: fmtIpMask(parseIpMask(n)!) } })) };
    }, 'Edit router.bgp');
    toast('BGP settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">BGP</div>
      <div className="edit-page">
        <div className="form-card">
          <Field label="Local AS" help="0 disables BGP.">
            <input className="inp sm" value={as} onChange={(e) => setAs(e.target.value)} />
          </Field>
          <Field label="Router ID" help="Empty / 0.0.0.0 = automatic (highest interface IP).">
            <input className="inp md" value={rid === '0.0.0.0' ? '' : rid} onChange={(e) => setRid(e.target.value)} />
          </Field>
          <Section title="Neighbors">
            {nbs.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 220 }}>
                <input className="inp md" placeholder="Neighbor IP" value={n.ip} onChange={(e) => setNbs(nbs.map((x, j) => (j === i ? { ...x, ip: e.target.value } : x)))} />
                <input className="inp sm" placeholder="Remote AS" value={n.as} onChange={(e) => setNbs(nbs.map((x, j) => (j === i ? { ...x, as: e.target.value } : x)))} />
                <button className="btn sm" onClick={() => setNbs(nbs.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ paddingLeft: 220 }}>
              <button className="btn sm" onClick={() => setNbs([...nbs, { ip: '', as: '' }])}>
                <Plus size={12} /> Create New
              </button>
            </div>
          </Section>
          <Section title="Networks">
            {nets.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 220 }}>
                <input className="inp md" value={n} onChange={(e) => setNets(nets.map((x, j) => (j === i ? e.target.value : x)))} />
                <button className="btn sm" onClick={() => setNets(nets.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ paddingLeft: 220 }}>
              <button className="btn sm" onClick={() => setNets([...nets, ''])}>
                <Plus size={12} /> Create New
              </button>
            </div>
          </Section>
          <div className="form-footer">
            <button className="btn primary" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
        <div className="side-card" style={{ width: 360 }}>
          <h4>Neighbor status</h4>
          {!net.bgp.enabled && <p className="muted">BGP is disabled (Local AS 0).</p>}
          {net.bgp.neighbors.map((n) => (
            <div key={n.ip} style={{ marginBottom: 8 }}>
              <div>
                <b>{n.ip}</b> AS {n.remoteAs}: {n.state === 'Established' ? <span className="badge ok">Established</span> : <span className="badge err">{n.state}</span>}
              </div>
              {n.reason && <div className="err-text" style={{ fontSize: 12 }}>{n.reason}</div>}
              {n.state === 'Established' && (
                <div className="muted mono" style={{ fontSize: 11 }}>
                  received: {n.received.join(', ')}
                  <br />
                  advertised: {n.advertised.join(', ') || 'none'}
                </div>
              )}
            </div>
          ))}
          <h4 style={{ marginTop: 14 }}>Your ISP agreement (lab)</h4>
          <div className="kv">
            <span>ISP router</span>
            <span className="mono">{ISP_BGP.ip}</span>
            <span>ISP AS</span>
            <span className="mono">{ISP_BGP.as}</span>
            <span>Your AS</span>
            <span className="mono">{ISP_BGP.customerAs}</span>
            <span>ISP sends</span>
            <span className="mono">{ISP_BGP.routes.join(', ')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- OSPF ----------

export function OspfPage() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const O = def('router ospf');
  const NW = O.fields.find((x) => x.name === 'network')!.sub!;
  const OI = O.fields.find((x) => x.name === 'ospf-interface')!.sub!;
  const o = config['router ospf']?.kind === 'object' ? config['router ospf'].f : {};
  const [rid, setRid] = useState(str(O, o, 'router-id'));
  const [areas, setAreas] = useState((sub(o, 'area')?.entries ?? []).map((e) => e.key));
  const [nets, setNets] = useState((sub(o, 'network')?.entries ?? []).map((e) => ({ prefix: cidr(str(NW, e.f, 'prefix')), area: str(NW, e.f, 'area') })));
  const [ifs, setIfs] = useState((sub(o, 'ospf-interface')?.entries ?? []).map((e) => ({ name: e.key, intf: str(OI, e.f, 'interface'), cost: str(OI, e.f, 'cost'), hello: str(OI, e.f, 'hello-interval'), dead: str(OI, e.f, 'dead-interval') })));
  const intfs = ifaceOptions(config).filter((x) => x.name !== 'ssl.root');

  const apply = () => {
    if (rid && rid !== '0.0.0.0' && !isIp(rid)) return toast('Router ID must be an IP address.', 'err');
    if (areas.some((a) => !isIp(a))) return toast('Area IDs are written like IP addresses, e.g. 0.0.0.0', 'err');
    if (nets.some((n) => !parseIpMask(n.prefix) || !isIp(n.area))) return toast('Each network needs a valid prefix and area.', 'err');
    if (nets.some((n) => !areas.includes(n.area))) return toast('Every network area must be created under Areas first.', 'err');
    if (new Set(areas).size !== areas.length) return toast('Each area can only be listed once.', 'err');
    const ifKeys = ifs.map((i) => i.name || `${i.intf}-ospf`);
    if (new Set(ifKeys).size !== ifKeys.length) return toast('Each OSPF interface entry needs a unique name.', 'err');
    const num = (v: string, lo: number, hi: number) => /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;
    if (ifs.some((i) => !i.intf)) return toast('Choose an interface for each OSPF interface entry.', 'err');
    if (ifs.some((i) => (i.cost && !num(i.cost, 0, 65535)) || !num(i.hello, 1, 65535) || !num(i.dead, 1, 65535))) return toast('Cost, hello and dead intervals must be numbers (hello/dead 1–65535).', 'err');
    if (ifs.some((i) => Number(i.dead) <= Number(i.hello))) return toast('The dead interval must be longer than the hello interval.', 'err');
    updateConfig((c) => {
      const f = objectOf(c, 'router ospf').f;
      if (rid && rid !== '0.0.0.0') f['router-id'] = rid;
      else delete f['router-id'];
      f.area = { kind: 'table', entries: areas.map((a) => ({ key: a, f: {} })) };
      f.network = { kind: 'table', entries: nets.map((n, i) => ({ key: String(i + 1), f: { prefix: fmtIpMask(parseIpMask(n.prefix)!), area: n.area } })) };
      f['ospf-interface'] = {
        kind: 'table',
        entries: ifs.map((i) => ({ key: i.name || `${i.intf}-ospf`, f: { interface: i.intf, ...(i.cost && i.cost !== '0' ? { cost: i.cost } : {}), ...(i.hello !== '10' ? { 'hello-interval': i.hello } : {}), ...(i.dead !== '40' ? { 'dead-interval': i.dead } : {}) } })),
      };
    }, 'Edit router.ospf');
    toast('OSPF settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">OSPF</div>
      <div className="edit-page">
        <div className="form-card">
          <Field label="Router ID" help="Empty = automatic (highest interface IP). Must be unique in the OSPF domain.">
            <input className="inp md" value={rid === '0.0.0.0' ? '' : rid} onChange={(e) => setRid(e.target.value)} />
          </Field>
          <Section title="Areas">
            {areas.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 220 }}>
                <input className="inp md" value={a} onChange={(e) => setAreas(areas.map((x, j) => (j === i ? e.target.value : x)))} />
                <span className="muted" style={{ paddingTop: 5 }}>Regular</span>
                <button className="btn sm" onClick={() => setAreas(areas.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ paddingLeft: 220 }}>
              <button className="btn sm" onClick={() => setAreas([...areas, '0.0.0.0'])}>
                <Plus size={12} /> Create New
              </button>
            </div>
          </Section>
          <Section title="Networks">
            {nets.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 220 }}>
                <input className="inp md" placeholder="Prefix" value={n.prefix} onChange={(e) => setNets(nets.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))} />
                <input className="inp sm" placeholder="Area" value={n.area} onChange={(e) => setNets(nets.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))} />
                <button className="btn sm" onClick={() => setNets(nets.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ paddingLeft: 220 }}>
              <button className="btn sm" onClick={() => setNets([...nets, { prefix: '', area: areas[0] ?? '0.0.0.0' }])}>
                <Plus size={12} /> Create New
              </button>
            </div>
          </Section>
          <Section title="Interfaces">
            {ifs.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 220, alignItems: 'center' }}>
                <select className="sel" style={{ width: 130 }} value={x.intf} onChange={(e) => setIfs(ifs.map((y, j) => (j === i ? { ...y, intf: e.target.value, name: `${e.target.value}-ospf` } : y)))}>
                  {intfs.map((o2) => (
                    <option key={o2.name}>{o2.name}</option>
                  ))}
                </select>
                <span className="muted">cost</span>
                <input className="inp" style={{ width: 55 }} value={x.cost} onChange={(e) => setIfs(ifs.map((y, j) => (j === i ? { ...y, cost: e.target.value } : y)))} />
                <span className="muted">hello</span>
                <input className="inp" style={{ width: 50 }} value={x.hello} onChange={(e) => setIfs(ifs.map((y, j) => (j === i ? { ...y, hello: e.target.value } : y)))} />
                <span className="muted">dead</span>
                <input className="inp" style={{ width: 50 }} value={x.dead} onChange={(e) => setIfs(ifs.map((y, j) => (j === i ? { ...y, dead: e.target.value } : y)))} />
                <button className="btn sm" onClick={() => setIfs(ifs.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ paddingLeft: 220 }}>
              <button className="btn sm" onClick={() => setIfs([...ifs, { name: '', intf: intfs[0]?.name ?? 'wan1', cost: '0', hello: '10', dead: '40' }])}>
                <Plus size={12} /> Create New
              </button>
            </div>
          </Section>
          <div className="form-footer">
            <button className="btn primary" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
        <div className="side-card" style={{ width: 360 }}>
          <h4>Neighbors</h4>
          {!net.ospf.enabled && <p className="muted">OSPF is not running: add a network statement.</p>}
          {net.ospf.enabled && !net.ospf.neighbors.length && <p className="muted">No neighbor yet. The branch speaks OSPF only through an Up IPsec tunnel.</p>}
          {net.ospf.neighbors.map((n) => (
            <div key={n.routerId} style={{ marginBottom: 8 }}>
              <b>{n.routerId}</b> on {n.intf}: {n.state === 'Full' ? <span className="badge ok">Full</span> : <span className="badge err">{n.state}</span>}
              {n.reason && <div className="err-text" style={{ fontSize: 12 }}>{n.reason}</div>}
            </div>
          ))}
          <h4 style={{ marginTop: 14 }}>Active OSPF interfaces</h4>
          {net.ospf.interfaces.map((i) => (
            <div key={i.name} className="mono" style={{ fontSize: 12 }}>
              {i.name} {i.ip} area {i.area} cost {i.cost} hello {i.hello}/{i.dead}
            </div>
          ))}
          <h4 style={{ marginTop: 14 }}>Branch-FGT OSPF (lab)</h4>
          <div className="kv">
            <span>Router ID</span>
            <span className="mono">{BRANCH_OSPF.routerId}</span>
            <span>Tunnel IP</span>
            <span className="mono">
              {BRANCH_OSPF.ip} (yours: {BRANCH_OSPF.localIp}, {BRANCH_OSPF.subnet})
            </span>
            <span>Area</span>
            <span className="mono">{BRANCH_OSPF.area}</span>
            <span>Hello / Dead</span>
            <span className="mono">
              {BRANCH_OSPF.hello} / {BRANCH_OSPF.dead}
            </span>
            <span>Advertises</span>
            <span className="mono">{BRANCH_OSPF.routes.map((r) => r.prefix).join(', ')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
