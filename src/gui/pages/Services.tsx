import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { navigate, useStore } from '../../store';
import { def, entries, find, list, str } from '../../engine/config';
import { parsePortRange } from '../../engine/ip';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field } from '../ui';
import { EntryPicker, svcDetail, svcOptions } from '../picker';
import { deleteEntry, nameError, saveEntry } from '../save';

const PAGE = 'pol-service';
const BUILTIN = new Set(['ALL', 'ALL_TCP', 'ALL_UDP', 'ALL_ICMP']);

interface Row {
  key: string;
  grp: boolean;
  detail: string;
  category: string;
  comment: string;
}

export function ServicesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  if (editKey?.startsWith('grp:')) return <GroupEdit name={editKey.slice(4)} />;
  if (editKey) return <ServiceEdit name={editKey === 'new' ? '' : editKey.slice(4)} />;
  return <ServiceList />;
}

function ServiceList() {
  const config = useStore((s) => s.config);
  const S = def('firewall service custom');
  const G = def('firewall service group');
  const svc: Row[] = entries(config, 'firewall service custom').map((e) => ({ key: e.key, grp: false, detail: svcDetail(config, e.key), category: str(S, e.f, 'category') || 'Uncategorized', comment: str(S, e.f, 'comment') }));
  const cats = [...new Set(svc.map((r) => r.category))];
  const grps: Row[] = entries(config, 'firewall service group').map((e) => ({ key: e.key, grp: true, detail: list(G, e.f, 'member').join(', '), category: '', comment: str(G, e.f, 'comment') }));
  const cols: Col<Row>[] = [
    { title: 'Name', render: (r) => <Chip kind={r.grp ? 'svcgrp' : 'svc'} name={r.key} /> },
    { title: 'Details', render: (r) => <span className={r.grp ? '' : 'mono'}>{r.detail}</span> },
    { title: 'Category', render: (r) => r.category },
    { title: 'Comments', render: (r) => <span className="muted">{r.comment}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">Services</div>
      <ObjectList<Row>
        groups={[...cats.map((c) => ({ title: c, rows: svc.filter((r) => r.category === c) })), { title: 'Service Group', rows: grps }]}
        cols={cols}
        refPathOf={(r) => (r.grp ? 'firewall service group' : 'firewall service custom')}
        createMenu={[
          { label: 'Service', onClick: () => navigate(PAGE, 'new') },
          { label: 'Service Group', onClick: () => navigate(PAGE, 'grp:') },
        ]}
        onEdit={(r) => navigate(PAGE, r.grp ? `grp:${r.key}` : `svc:${r.key}`)}
        canDelete={(r) => (BUILTIN.has(r.key) ? `"${r.key}" is a built-in service and cannot be deleted.` : null)}
        onDelete={(r) => deleteEntry(r.grp ? 'firewall service group' : 'firewall service custom', r.key)}
        search={(r, q) => `${r.key} ${r.detail}`.toLowerCase().includes(q)}
      />
    </div>
  );
}

interface PortRow {
  proto: 'TCP' | 'UDP' | 'SCTP';
  dst: string;
  src: string;
}

function ServiceEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const S = def('firewall service custom');
  const e = name ? find(config, 'firewall service custom', name) : undefined;
  const s = (n: string) => (e ? str(S, e.f, n) : '');
  const initialPorts: PortRow[] = e
    ? (['tcp', 'udp', 'sctp'] as const).flatMap((p) =>
        list(S, e.f, `${p}-portrange`).map((r) => {
          const [dst, src = ''] = r.split(':');
          return { proto: p.toUpperCase() as PortRow['proto'], dst, src };
        }),
      )
    : [{ proto: 'TCP', dst: '', src: '' }];
  const [f, setF] = useState({
    name,
    category: s('category') || 'Uncategorized',
    protocol: e ? s('protocol') : 'TCP/UDP/SCTP',
    icmptype: s('icmptype'),
    icmpcode: s('icmpcode'),
    protoNum: s('protocol-number') || '0',
    comment: s('comment'),
  });
  const [ports, setPorts] = useState<PortRow[]>(initialPorts.length ? initialPorts : [{ proto: 'TCP', dst: '', src: '' }]);
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const cats = entries(config, 'firewall service category').map((c) => c.key);

  const save = () => {
    const ne = nameError(config, 'firewall service custom', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const fields: Record<string, string | string[]> = {};
    if (f.category !== 'Uncategorized') fields.category = f.category;
    if (f.protocol !== 'TCP/UDP/SCTP') fields.protocol = f.protocol;
    if (f.protocol === 'TCP/UDP/SCTP') {
      const rows = ports.filter((p) => p.dst.trim());
      if (!rows.length) return setErr('Add at least one destination port.');
      for (const p of rows) if (!parsePortRange(p.dst) || (p.src && !parsePortRange(p.src))) return setErr(`Invalid port range "${p.dst}${p.src ? ':' + p.src : ''}". Use 80 or 8080-8090.`);
      for (const pr of ['TCP', 'UDP', 'SCTP'] as const) {
        const v = rows.filter((p) => p.proto === pr).map((p) => (p.src ? `${p.dst}:${p.src}` : p.dst));
        if (v.length) fields[`${pr.toLowerCase()}-portrange`] = v;
      }
    } else if (f.protocol === 'ICMP') {
      if (f.icmptype) fields.icmptype = f.icmptype;
      if (f.icmpcode) fields.icmpcode = f.icmpcode;
    } else if (f.protocol === 'IP') {
      const n = Number(f.protoNum);
      if (!(n >= 0 && n <= 254)) return setErr('Protocol number must be 0–254 (0 = any).');
      if (n) fields['protocol-number'] = String(n);
    }
    if (f.comment) fields.comment = f.comment;
    saveEntry('firewall service custom', name || null, f.name.trim(), fields, 'Service');
    navigate(PAGE);
  };

  return (
    <EditPage title={name ? `Edit Service: ${name}` : 'New Service'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Category">
        <select className="sel" value={f.category} onChange={(e) => up('category', e.target.value)}>
          <option>Uncategorized</option>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Protocol Type">
        <select className="sel" value={f.protocol} onChange={(e) => up('protocol', e.target.value)}>
          <option value="TCP/UDP/SCTP">TCP/UDP/SCTP</option>
          <option value="ICMP">ICMP</option>
          <option value="IP">IP</option>
        </select>
      </Field>
      {f.protocol === 'TCP/UDP/SCTP' && (
        <Field label="Destination Port" help="Optional source port range after it. Example: 443, or 8080-8090.">
          {ports.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <select className="sel" style={{ width: 90 }} value={p.proto} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, proto: e.target.value as PortRow['proto'] } : x)))}>
                <option>TCP</option>
                <option>UDP</option>
                <option>SCTP</option>
              </select>
              <input className="inp sm" placeholder="Low-High" value={p.dst} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, dst: e.target.value } : x)))} />
              <span className="muted">src</span>
              <input className="inp sm" placeholder="(any)" value={p.src} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))} />
              <button className="btn sm" onClick={() => setPorts(ports.filter((_, j) => j !== i))} disabled={ports.length === 1}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setPorts([...ports, { proto: 'TCP', dst: '', src: '' }])}>
            <Plus size={12} /> Add
          </button>
        </Field>
      )}
      {f.protocol === 'ICMP' && (
        <>
          <Field label="Type" help="8 = echo request (ping). Empty = any.">
            <input className="inp sm" value={f.icmptype} onChange={(e) => up('icmptype', e.target.value)} />
          </Field>
          <Field label="Code">
            <input className="inp sm" value={f.icmpcode} onChange={(e) => up('icmpcode', e.target.value)} />
          </Field>
        </>
      )}
      {f.protocol === 'IP' && (
        <Field label="Protocol Number" help="0 = any protocol; 47 = GRE; 50 = ESP; 89 = OSPF.">
          <input className="inp sm" value={f.protoNum} onChange={(e) => up('protoNum', e.target.value)} />
        </Field>
      )}
      <Field label="Comments">
        <textarea className="inp" value={f.comment} onChange={(e) => up('comment', e.target.value)} />
      </Field>
    </EditPage>
  );
}

function GroupEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const G = def('firewall service group');
  const e = name ? find(config, 'firewall service group', name) : undefined;
  const [gn, setGn] = useState(name);
  const [members, setMembers] = useState<string[]>(e ? list(G, e.f, 'member') : []);
  const [comment, setComment] = useState(e ? str(G, e.f, 'comment') : '');
  const [err, setErr] = useState('');
  const save = () => {
    const ne = nameError(config, 'firewall service group', name || null, gn.trim());
    if (ne) return setErr(ne);
    if (!members.length) return setErr('A group needs at least one member.');
    saveEntry('firewall service group', name || null, gn.trim(), { member: members, ...(comment ? { comment } : {}) }, 'Service group');
    navigate(PAGE);
  };
  return (
    <EditPage title={name ? `Edit Service Group: ${name}` : 'New Service Group'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={gn} onChange={(e) => setGn(e.target.value)} />
      </Field>
      <Field label="Members">
        <EntryPicker value={members} options={svcOptions(config, name)} onChange={setMembers} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </EditPage>
  );
}
