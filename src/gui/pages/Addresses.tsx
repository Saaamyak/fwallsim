import { useState } from 'react';
import { navigate, useStore } from '../../store';
import { def, entries, find, list, newUuid, str } from '../../engine/config';
import { fmtIpMask, isIp, ipToInt, parseIpMask } from '../../engine/ip';
import { HOSTS } from '../../engine/topology';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field, Seg, Toggle } from '../ui';
import { addrDetail, addrOptions, EntryPicker, ifaceOptions } from '../picker';
import { deleteEntry, nameError, saveEntry } from '../save';

const PAGE = 'pol-address';
const COUNTRIES = [...new Set(HOSTS.map((h) => h.country).filter((c) => c !== 'Reserved'))].sort();

interface Row {
  key: string;
  grp: boolean;
  detail: string;
  intf: string;
  type: string;
  comment: string;
}

export function AddressesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  if (editKey?.startsWith('grp:')) return <GroupEdit name={editKey.slice(4)} />;
  if (editKey) return <AddressEdit name={editKey === 'new' ? '' : editKey.slice(5)} />;
  return <AddressList />;
}

function AddressList() {
  const config = useStore((s) => s.config);
  const A = def('firewall address');
  const G = def('firewall addrgrp');
  const TYPES: Record<string, string> = { ipmask: 'Subnet', iprange: 'IP Range', fqdn: 'FQDN', geography: 'Geography', wildcard: 'Wildcard' };
  const addrs: Row[] = entries(config, 'firewall address').map((e) => ({ key: e.key, grp: false, detail: addrDetail(config, e.key), intf: str(A, e.f, 'associated-interface') || 'any', type: TYPES[str(A, e.f, 'type')] ?? str(A, e.f, 'type'), comment: str(A, e.f, 'comment') }));
  const groups: Row[] = entries(config, 'firewall addrgrp').map((e) => ({ key: e.key, grp: true, detail: list(G, e.f, 'member').join(', '), intf: '', type: 'Group', comment: str(G, e.f, 'comment') }));
  const cols: Col<Row>[] = [
    { title: 'Name', render: (r) => <Chip kind={r.grp ? 'grp' : 'addr'} name={r.key} /> },
    { title: 'Details', render: (r) => <span className={r.grp ? '' : 'mono'}>{r.detail}</span> },
    { title: 'Interface', render: (r) => r.intf },
    { title: 'Type', render: (r) => r.type },
    { title: 'Comments', render: (r) => <span className="muted">{r.comment}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">Addresses</div>
      <ObjectList<Row>
        groups={[
          { title: 'Address', rows: addrs },
          { title: 'Address Group', rows: groups },
        ]}
        cols={cols}
        refPathOf={(r) => (r.grp ? 'firewall addrgrp' : 'firewall address')}
        createMenu={[
          { label: 'Address', onClick: () => navigate(PAGE, 'new') },
          { label: 'Address Group', onClick: () => navigate(PAGE, 'grp:') },
        ]}
        onEdit={(r) => navigate(PAGE, r.grp ? `grp:${r.key}` : `addr:${r.key}`)}
        canDelete={(r) => (['all', 'none'].includes(r.key) ? `"${r.key}" is a built-in address and cannot be deleted.` : null)}
        onDelete={(r) => deleteEntry(r.grp ? 'firewall addrgrp' : 'firewall address', r.key)}
        search={(r, q) => `${r.key} ${r.detail} ${r.comment}`.toLowerCase().includes(q)}
      />
    </div>
  );
}

function AddressEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const A = def('firewall address');
  const e = name ? find(config, 'firewall address', name) : undefined;
  const s = (n: string) => (e ? str(A, e.f, n) : '');
  const sub = parseIpMask(s('subnet') || '0.0.0.0 0.0.0.0');
  const [f, setF] = useState({
    name,
    type: e ? s('type') : 'ipmask',
    subnet: sub ? `${s('subnet').split(' ')[0]}/${s('subnet').split(' ')[1]}` : '',
    start: s('start-ip'),
    end: s('end-ip'),
    fqdn: s('fqdn'),
    country: s('country') || COUNTRIES[0],
    intf: s('associated-interface') || 'any',
    routing: s('allow-routing') === 'enable',
    comment: s('comment'),
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  if (e && ['all', 'none'].includes(name)) f.type = 'ipmask';

  const save = () => {
    const ne = nameError(config, 'firewall address', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const fields: Record<string, string> = {};
    if (e) fields.uuid = str(A, e.f, 'uuid') || newUuid();
    else fields.uuid = newUuid();
    if (f.type !== 'ipmask') fields.type = f.type;
    if (f.type === 'ipmask') {
      const n = parseIpMask(f.subnet);
      if (!n) return setErr('Enter a valid IP/netmask, e.g. 192.168.1.0/24 or 10.10.10.10/32.');
      fields.subnet = fmtIpMask(n);
    } else if (f.type === 'iprange') {
      if (!isIp(f.start) || !isIp(f.end) || ipToInt(f.start)! > ipToInt(f.end)!) return setErr('Enter a valid IP range (start ≤ end).');
      fields['start-ip'] = f.start;
      fields['end-ip'] = f.end;
    } else if (f.type === 'fqdn') {
      if (!/^[*A-Za-z0-9.-]+$/.test(f.fqdn)) return setErr('Enter a valid FQDN, e.g. www.example.com.');
      fields.fqdn = f.fqdn;
    } else fields.country = f.country;
    if (f.intf !== 'any') fields['associated-interface'] = f.intf;
    if (f.routing && f.type === 'ipmask') fields['allow-routing'] = 'enable';
    if (f.comment) fields.comment = f.comment;
    saveEntry('firewall address', name || null, f.name.trim(), fields, 'Address');
    navigate(PAGE);
  };

  return (
    <EditPage title={name ? `Edit Address: ${name}` : 'New Address'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Type">
        <select className="sel" value={f.type} onChange={(e) => up('type', e.target.value)}>
          <option value="ipmask">Subnet</option>
          <option value="iprange">IP Range</option>
          <option value="fqdn">FQDN</option>
          <option value="geography">Geography</option>
        </select>
      </Field>
      {f.type === 'ipmask' && (
        <Field label="IP/Netmask" help="A single host is /32, e.g. 10.10.10.10/32.">
          <input className="inp" value={f.subnet} onChange={(e) => up('subnet', e.target.value)} placeholder="192.168.1.0/24" />
        </Field>
      )}
      {f.type === 'iprange' && (
        <Field label="IP Range">
          <input className="inp md" value={f.start} onChange={(e) => up('start', e.target.value)} /> - <input className="inp md" value={f.end} onChange={(e) => up('end', e.target.value)} />
        </Field>
      )}
      {f.type === 'fqdn' && (
        <Field label="FQDN" help="Resolved by the FortiGate's DNS; the policy matches the resolved IP addresses.">
          <input className="inp" value={f.fqdn} onChange={(e) => up('fqdn', e.target.value)} placeholder="www.example.com" />
        </Field>
      )}
      {f.type === 'geography' && (
        <Field label="Country/Region" help="Matched by the GeoIP database (simulated per lab host).">
          <select className="sel" value={f.country} onChange={(e) => up('country', e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Interface">
        <select className="sel" value={f.intf} onChange={(e) => up('intf', e.target.value)}>
          {ifaceOptions(config, { any: true, zones: true }).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </select>
      </Field>
      {f.type === 'ipmask' && (
        <Field label="Static route configuration">
          <Toggle on={f.routing} onChange={(v) => up('routing', v)} />
        </Field>
      )}
      <Field label="Comments">
        <textarea className="inp" maxLength={255} value={f.comment} onChange={(e) => up('comment', e.target.value)} />
      </Field>
    </EditPage>
  );
}

function GroupEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const G = def('firewall addrgrp');
  const e = name ? find(config, 'firewall addrgrp', name) : undefined;
  const [gn, setGn] = useState(name);
  const [members, setMembers] = useState<string[]>(e ? list(G, e.f, 'member') : []);
  const [comment, setComment] = useState(e ? str(G, e.f, 'comment') : '');
  const [type, setType] = useState<'group'>('group');
  const [err, setErr] = useState('');
  const save = () => {
    const ne = nameError(config, 'firewall addrgrp', name || null, gn.trim());
    if (ne) return setErr(ne);
    if (!members.length) return setErr('A group needs at least one member.');
    saveEntry('firewall addrgrp', name || null, gn.trim(), { uuid: (e && str(G, e.f, 'uuid')) || newUuid(), member: members, ...(comment ? { comment } : {}) }, 'Address group');
    navigate(PAGE);
  };
  return (
    <EditPage title={name ? `Edit Address Group: ${name}` : 'New Address Group'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Group name">
        <input className="inp" value={gn} onChange={(e) => setGn(e.target.value)} />
      </Field>
      <Field label="Type">
        <Seg value={type} onChange={setType} options={[{ v: 'group', label: 'Group' }]} />
      </Field>
      <Field label="Members" help="Groups can contain addresses and other groups (nesting).">
        <EntryPicker value={members} options={addrOptions(config, { exclude: name })} onChange={setMembers} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </EditPage>
  );
}
