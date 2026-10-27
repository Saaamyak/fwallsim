import { useState } from 'react';
import { navigate, useStore } from '../../store';
import { def, find, newUuid, str } from '../../engine/config';
import { parseIpRange, parsePortRange } from '../../engine/ip';
import { vipDesc, vips, type VipView } from '../../engine/views';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field, Section, Seg, Toggle } from '../ui';
import { ifaceOptions } from '../picker';
import { deleteEntry, nameError, saveEntry } from '../save';

const PAGE = 'pol-vip';

export function VipsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <VipEdit name={editKey === 'new' ? '' : editKey} /> : <VipList />;
}

function VipList() {
  const config = useStore((s) => s.config);
  const rows = vips(config).map((v) => ({ ...v, key: v.name }));
  const cols: Col<VipView & { key: string }>[] = [
    { title: 'Name', render: (r) => <Chip kind="vip" name={r.name} /> },
    { title: 'Details', render: (r) => <span className="mono">{vipDesc(r)}</span> },
    { title: 'Interface', render: (r) => r.extintf },
    { title: 'Comments', render: (r) => <span className="muted">{r.comment}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">Virtual IPs</div>
      <ObjectList
        groups={[{ title: 'Virtual IP', rows }]}
        cols={cols}
        refPathOf={() => 'firewall vip'}
        onCreate={() => navigate(PAGE, 'new')}
        onEdit={(r) => navigate(PAGE, r.key)}
        onDelete={(r) => deleteEntry('firewall vip', r.key)}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        A Virtual IP is destination NAT: traffic to the external IP (and port) is translated to an internal server. A VIP does nothing on its own; a firewall policy with the VIP as destination must allow the traffic.
      </p>
    </div>
  );
}

function VipEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const V = def('firewall vip');
  const e = name ? find(config, 'firewall vip', name) : undefined;
  const v = name ? vips(config).find((x) => x.name === name) : undefined;
  const [f, setF] = useState({
    name,
    comment: v?.comment ?? '',
    extintf: v?.extintf ?? 'wan1',
    extip: v?.extip ?? '',
    mappedip: v?.mappedip ?? '',
    arp: v ? v.arpReply : true,
    pf: v?.portforward ?? false,
    protocol: v?.protocol ?? 'tcp',
    extport: v?.extport ?? '',
    mappedport: v?.mappedport ?? '',
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF({ ...f, [k]: val });

  const save = () => {
    const ne = nameError(config, 'firewall vip', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const ext = parseIpRange(f.extip);
    const map = parseIpRange(f.mappedip);
    if (!ext) return setErr('Enter a valid external IP address or range, e.g. 203.0.113.10.');
    if (!map) return setErr('Enter a valid mapped IP address or range, e.g. 10.10.10.10.');
    if (ext[1] - ext[0] !== map[1] - map[0]) return setErr('The external and mapped ranges must be the same size.');
    const fields: Record<string, string | string[]> = { uuid: (e && str(V, e.f, 'uuid')) || newUuid(), extip: [f.extip.trim()], mappedip: [f.mappedip.trim()], extintf: f.extintf };
    if (!f.arp) fields['arp-reply'] = 'disable';
    if (f.pf) {
      const ep = parsePortRange(f.extport);
      const mp = parsePortRange(f.mappedport || f.extport);
      if (!ep || !mp) return setErr('Enter valid ports, e.g. 8080 or 8080-8090.');
      if (ep[1] - ep[0] !== mp[1] - mp[0]) return setErr('External and mapped port ranges must be the same size.');
      fields.portforward = 'enable';
      if (f.protocol !== 'tcp') fields.protocol = f.protocol;
      fields.extport = [f.extport.trim()];
      fields.mappedport = [(f.mappedport || f.extport).trim()];
    }
    if (f.comment) fields.comment = f.comment;
    saveEntry('firewall vip', name || null, f.name.trim(), fields, 'Virtual IP');
    navigate(PAGE);
  };

  return (
    <EditPage title={name ? `Edit Virtual IP: ${name}` : 'New Virtual IP'} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="VIP type">IPv4</Field>
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={f.comment} onChange={(e) => up('comment', e.target.value)} />
      </Field>
      <Section title="Network">
        <Field label="Interface" help="The interface where traffic for the external IP arrives (usually the WAN).">
          <select className="sel" value={f.extintf} onChange={(e) => up('extintf', e.target.value)}>
            {ifaceOptions(config, { any: true }).map((o) => (
              <option key={o.name}>{o.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Type">Static NAT</Field>
        <Field label="External IP address/range" help="Can be the wan1 address itself (203.0.113.10) or another address in the WAN subnet.">
          <input className="inp" value={f.extip} onChange={(e) => up('extip', e.target.value)} placeholder="203.0.113.10" />
        </Field>
        <Field label="Map to IPv4 address/range">
          <input className="inp" value={f.mappedip} onChange={(e) => up('mappedip', e.target.value)} placeholder="10.10.10.10" />
        </Field>
        <Field label="ARP reply" help="Answer ARP for the external IP, so the ISP router can deliver traffic for it.">
          <Toggle on={f.arp} onChange={(v) => up('arp', v)} />
        </Field>
      </Section>
      <Section title={<Toggle on={f.pf} onChange={(v) => up('pf', v)} label="Port Forwarding" />}>
        {f.pf ? (
          <>
            <Field label="Protocol">
              <Seg
                value={f.protocol}
                onChange={(v) => up('protocol', v)}
                options={[
                  { v: 'tcp', label: 'TCP' },
                  { v: 'udp', label: 'UDP' },
                  { v: 'sctp', label: 'SCTP' },
                ]}
              />
            </Field>
            <Field label="Port Mapping Type">One to one</Field>
            <Field label="External service port">
              <input className="inp sm" value={f.extport} onChange={(e) => up('extport', e.target.value)} placeholder="80" />
            </Field>
            <Field label="Map to IPv4 port">
              <input className="inp sm" value={f.mappedport} onChange={(e) => up('mappedport', e.target.value)} placeholder="80" />
            </Field>
          </>
        ) : (
          <p className="muted">Without port forwarding, all ports of the external IP are mapped 1:1 to the internal server.</p>
        )}
      </Section>
    </EditPage>
  );
}
