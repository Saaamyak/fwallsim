import { useState } from 'react';
import { navigate, useStore } from '../../store';
import { ipToInt, isIp } from '../../engine/ip';
import { ippools, type PoolView } from '../../engine/views';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field, Seg, Toggle } from '../ui';
import { deleteEntry, nameError, saveEntry } from '../save';

const PAGE = 'pol-ippool';
const TYPES: Record<string, string> = { overload: 'Overload', 'one-to-one': 'One-to-One', 'fixed-port-range': 'Fixed Port Range', 'port-block-allocation': 'Port Block Allocation' };

export function IpPoolsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <PoolEdit name={editKey === 'new' ? '' : editKey} /> : <PoolList />;
}

function PoolList() {
  const config = useStore((s) => s.config);
  const rows = ippools(config).map((p) => ({ ...p, key: p.name }));
  const cols: Col<PoolView & { key: string }>[] = [
    { title: 'Name', render: (r) => <Chip kind="pool" name={r.name} /> },
    { title: 'External IP Range', render: (r) => <span className="mono">{`${r.startip} - ${r.endip}`}</span> },
    { title: 'Type', render: (r) => TYPES[r.type] },
    { title: 'ARP Reply', render: (r) => (r.arpReply ? 'Enabled' : 'Disabled') },
    { title: 'Comments', render: (r) => <span className="muted">{r.comments}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">IP Pools</div>
      <ObjectList groups={[{ title: 'IPv4 Pool', rows }]} cols={cols} refPathOf={() => 'firewall ippool'} onCreate={() => navigate(PAGE, 'new')} onEdit={(r) => navigate(PAGE, r.key)} onDelete={(r) => deleteEntry('firewall ippool', r.key)} />
      <p className="muted" style={{ marginTop: 10 }}>
        An IP pool replaces the outgoing interface address in source NAT. In the lab, the ISP only routes 203.0.113.0/24 to you, so a usable pool must come from that subnet with ARP reply on. Try 203.0.113.20–203.0.113.20.
      </p>
    </div>
  );
}

function PoolEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const p = name ? ippools(config).find((x) => x.name === name) : undefined;
  const [f, setF] = useState({
    name,
    comments: p?.comments ?? '',
    type: p?.type ?? 'overload',
    start: p?.startip ?? '',
    end: p?.endip ?? '',
    arp: p ? p.arpReply : true,
    srcStart: p?.sourceStart ?? '',
    srcEnd: p?.sourceEnd ?? '',
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const save = () => {
    const ne = nameError(config, 'firewall ippool', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const end = f.end || f.start;
    if (!isIp(f.start) || !isIp(end) || ipToInt(f.start)! > ipToInt(end)!) return setErr('Enter a valid external IP range.');
    const fields: Record<string, string> = { startip: f.start, endip: end };
    if (f.type !== 'overload') fields.type = f.type;
    if (f.type === 'fixed-port-range') {
      if (!isIp(f.srcStart) || !isIp(f.srcEnd) || ipToInt(f.srcStart)! > ipToInt(f.srcEnd)!) return setErr('Enter a valid internal (source) IP range: start must not be after end.');
      fields['source-startip'] = f.srcStart;
      fields['source-endip'] = f.srcEnd;
    }
    if (!f.arp) fields['arp-reply'] = 'disable';
    if (f.comments) fields.comments = f.comments;
    saveEntry('firewall ippool', name || null, f.name.trim(), fields, 'IP pool');
    navigate(PAGE);
  };

  return (
    <EditPage title={name ? `Edit IP Pool: ${name}` : 'New Dynamic IP Pool'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={f.comments} onChange={(e) => up('comments', e.target.value)} />
      </Field>
      <Field label="Type">
        <Seg value={f.type} onChange={(v) => up('type', v)} options={Object.entries(TYPES).map(([v, label]) => ({ v, label }))} />
      </Field>
      <Field label="External IP address/range">
        <input className="inp md" value={f.start} onChange={(e) => up('start', e.target.value)} placeholder="203.0.113.20" /> - <input className="inp md" value={f.end} onChange={(e) => up('end', e.target.value)} placeholder="203.0.113.20" />
      </Field>
      {f.type === 'fixed-port-range' && (
        <Field label="Internal IP Range">
          <input className="inp md" value={f.srcStart} onChange={(e) => up('srcStart', e.target.value)} /> - <input className="inp md" value={f.srcEnd} onChange={(e) => up('srcEnd', e.target.value)} />
        </Field>
      )}
      <Field label="ARP Reply">
        <Toggle on={f.arp} onChange={(v) => up('arp', v)} />
      </Field>
    </EditPage>
  );
}
