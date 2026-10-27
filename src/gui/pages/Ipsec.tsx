import { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { navigate, toast, updateConfig, useStore, vpnSetDown } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, findRefs, list, newUuid, nextKey, str, tableOf } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { fmtIpMask, intToIp, parseIpMask, isIp } from '../../engine/ip';
import { P1_DEFAULT_PROPOSALS, P1_PROPOSAL_CHOICES, P2_DEFAULT_PROPOSALS, P2_PROPOSAL_CHOICES } from '../../engine/vpn';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Modal, Section, Seg, Toggle } from '../ui';
import { ifaceOptions } from '../picker';

const DH = ['1', '2', '5', '14', '15', '16', '19', '20', '21'];
const cidr = (s: string) => {
  const n = parseIpMask(s);
  return n ? `${intToIp(n.ip)}/${n.prefix}` : s;
};

// ---------- list ----------

interface Row {
  key: string;
  remote: string;
  intf: string;
  up: boolean;
  error?: string;
  selectors: string[];
  ver: string;
}

export function IpsecTunnelsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <TunnelEdit name={editKey} /> : <TunnelList />;
}

function TunnelList() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const P1 = def('vpn ipsec phase1-interface');
  const rows: Row[] = entries(config, 'vpn ipsec phase1-interface').map((e) => {
    const t = net.tunnels[e.key];
    return {
      key: e.key,
      remote: str(P1, e.f, 'remote-gw'),
      intf: str(P1, e.f, 'interface'),
      up: !!t?.up,
      error: t?.error,
      ver: str(P1, e.f, 'ike-version'),
      selectors: (t?.p2 ?? []).map((p) => `${p.up ? '▲' : '▼'} ${p.name}: ${cidr(p.src)} ↔ ${cidr(p.dst)}`),
    };
  });
  const cols: Col<Row>[] = [
    {
      title: 'Tunnel',
      render: (r) => (
        <span className="chip">
          {r.up ? <ArrowUpCircle size={14} color="var(--ok)" /> : <ArrowDownCircle size={14} color="var(--err)" />}
          <b>{r.key}</b>
        </span>
      ),
    },
    { title: 'Interface Binding', render: (r) => r.intf },
    { title: 'Remote Gateway', render: (r) => <span className="mono">{r.remote}</span> },
    { title: 'IKE', render: (r) => `v${r.ver}` },
    { title: 'Status', render: (r) => (r.up ? <span className="badge ok">Up</span> : <span className="badge err" title={r.error}>Down</span>) },
    { title: 'Phase 2 Selectors', render: (r) => <div className="chips mono" style={{ fontSize: 12 }}>{r.selectors.map((s) => <span key={s}>{s}</span>)}</div> },
    { title: 'Reason', render: (r) => <span className={r.up ? 'muted' : 'err-text'} style={{ fontSize: 12 }}>{r.up ? 'Established' : r.error}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">IPsec Tunnels</div>
      <ObjectList<Row>
        groups={[{ title: 'Site to Site - FortiGate', rows }]}
        cols={cols}
        createMenu={[
          { label: 'IPsec Tunnel (wizard)', onClick: () => navigate('vpn-wizard') },
          { label: 'Custom IPsec Tunnel', onClick: () => navigate('vpn-ipsec', 'new') },
        ]}
        onEdit={(r) => navigate('vpn-ipsec', r.key)}
        canDelete={(r) => {
          const used = findRefs(config, 'system interface', r.key);
          return used.length ? `Tunnel "${r.key}" is used by ${used.length} object(s) (${used.map((u) => `${u.path} ${u.key}`).join(', ')}). Remove those first.` : null;
        }}
        onDelete={(r) =>
          updateConfig((c) => {
            tableOf(c, 'vpn ipsec phase2-interface').entries = entries(c, 'vpn ipsec phase2-interface').filter((e) => str(def('vpn ipsec phase2-interface'), e.f, 'phase1name') !== r.key);
            tableOf(c, 'vpn ipsec phase1-interface').entries = entries(c, 'vpn ipsec phase1-interface').filter((e) => e.key !== r.key);
          }, `Delete vpn.ipsec.phase1-interface ${r.key}`)
        }
        extraTools={
          <>
            {rows.map((r) => (
              <button key={r.key} className="btn" onClick={() => vpnSetDown(r.key, r.up)} title={r.up ? 'Bring Down' : 'Bring Up'}>
                <Power size={14} /> {r.up ? 'Bring Down' : 'Bring Up'} {r.key}
              </button>
            ))}
          </>
        }
      />
      <p className="muted" style={{ marginTop: 10 }}>
        The branch side is fixed: see <b>Lab &gt; VPN</b> for the settings you must match. When a tunnel is down, the Reason column (and <span className="mono">diagnose debug application ike -1</span> in the CLI) tells you why.
      </p>
    </div>
  );
}

// ---------- wizard ----------

export function IpsecWizardPage() {
  const config = useStore((s) => s.config);
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: 'to-branch', remote: '198.51.100.200', outIntf: 'wan1', psk: '', localIntf: 'internal', local: '192.168.1.0/24', remote_net: '10.20.0.0/24' });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const validate = (s: number): string | null => {
    if (s === 1) {
      if (!/^[A-Za-z0-9_-]{1,13}$/.test(f.name)) return 'Name: 1–13 characters (letters, digits, - and _). It also becomes the tunnel interface name.';
      if (find(config, 'vpn ipsec phase1-interface', f.name) || find(config, 'system interface', f.name)) return 'A tunnel or interface with this name already exists.';
    }
    if (s === 2) {
      if (!isIp(f.remote)) return 'Enter the remote gateway IP address.';
      if (f.psk.length < 6) return 'The pre-shared key must be at least 6 characters.';
    }
    if (s === 3 && (!parseIpMask(f.local) || !parseIpMask(f.remote_net))) return 'Enter valid local and remote subnets, e.g. 192.168.1.0/24.';
    return null;
  };
  const nextStep = () => {
    const e = validate(step);
    setErr(e ?? '');
    if (!e) setStep(step + 1);
  };

  const create = () => {
    const n = f.name;
    const local = parseIpMask(f.local)!;
    const remote = parseIpMask(f.remote_net)!;
    updateConfig((c) => {
      tableOf(c, 'vpn ipsec phase1-interface').entries.push({ key: n, f: { interface: f.outIntf, 'ike-version': '2', peertype: 'any', 'net-device': 'disable', proposal: P1_DEFAULT_PROPOSALS, dhgrp: ['14', '5'], 'remote-gw': f.remote, psksecret: f.psk, comments: `VPN: ${n} (Created by VPN wizard)` } });
      tableOf(c, 'vpn ipsec phase2-interface').entries.push({ key: n, f: { phase1name: n, proposal: P2_DEFAULT_PROPOSALS, dhgrp: ['14', '5'], 'src-subnet': fmtIpMask(local), 'dst-subnet': fmtIpMask(remote), comments: `VPN: ${n} (Created by VPN wizard)` } });
      const A = tableOf(c, 'firewall address');
      A.entries.push({ key: `${n}_local_subnet_1`, f: { uuid: newUuid(), subnet: fmtIpMask(local), comment: `VPN: ${n} (Created by VPN wizard)` } });
      A.entries.push({ key: `${n}_remote_subnet_1`, f: { uuid: newUuid(), subnet: fmtIpMask(remote), comment: `VPN: ${n} (Created by VPN wizard)` } });
      const G = tableOf(c, 'firewall addrgrp');
      G.entries.push({ key: `${n}_local`, f: { uuid: newUuid(), member: [`${n}_local_subnet_1`], comment: `VPN: ${n} (Created by VPN wizard)` } });
      G.entries.push({ key: `${n}_remote`, f: { uuid: newUuid(), member: [`${n}_remote_subnet_1`], comment: `VPN: ${n} (Created by VPN wizard)` } });
      const R = tableOf(c, 'router static');
      const k1 = nextKey(c, 'router static');
      R.entries.push({ key: k1, f: { dst: fmtIpMask(remote), device: n, comment: `VPN: ${n} (Created by VPN wizard)` } });
      R.entries.push({ key: String(Number(k1) + 1), f: { dst: fmtIpMask(remote), blackhole: 'enable', distance: '254', comment: `VPN: ${n} (Created by VPN wizard)` } });
      const P = tableOf(c, 'firewall policy');
      const p1 = nextKey(c, 'firewall policy');
      P.entries.push({ key: p1, f: { name: `vpn_${n}_local`, uuid: newUuid(), srcintf: [f.localIntf], dstintf: [n], action: 'accept', srcaddr: [`${n}_local`], dstaddr: [`${n}_remote`], schedule: 'always', service: ['ALL'], comments: `VPN: ${n} (Created by VPN wizard)` } });
      P.entries.push({ key: String(Number(p1) + 1), f: { name: `vpn_${n}_remote`, uuid: newUuid(), srcintf: [n], dstintf: [f.localIntf], action: 'accept', srcaddr: [`${n}_remote`], dstaddr: [`${n}_local`], schedule: 'always', service: ['ALL'], comments: `VPN: ${n} (Created by VPN wizard)` } });
    }, `VPN wizard created site-to-site tunnel ${n}`);
    toast(`VPN "${n}" created: phase 1/2, addresses, routes and policies`);
    navigate('vpn-ipsec');
  };

  const intfs = ifaceOptions(config).filter((o) => o.name !== 'ssl.root');
  const steps = ['VPN Setup', 'Authentication', 'Policy & Routing', 'Review Settings'];
  return (
    <div className="page">
      <div className="page-title">VPN Creation Wizard</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {steps.map((s, i) => (
          <span key={s} className={`badge ${step === i + 1 ? 'ok' : step > i + 1 ? 'info' : 'grey'}`} style={{ padding: '4px 10px' }}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className="form-card">
        {err && <p className="err-text">{err}</p>}
        {step === 1 && (
          <>
            <Field label="Name" help="Also becomes the name of the tunnel interface used in routes and policies.">
              <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />
            </Field>
            <Field label="Template type">Site to Site</Field>
            <Field label="NAT configuration">No NAT between sites</Field>
            <Field label="Remote device type">FortiGate</Field>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="Remote device">IP Address</Field>
            <Field label="Remote IP address" help="Public address of the branch FortiGate.">
              <input className="inp" value={f.remote} onChange={(e) => up('remote', e.target.value)} />
            </Field>
            <Field label="Outgoing Interface">
              <select className="sel" value={f.outIntf} onChange={(e) => up('outIntf', e.target.value)}>
                {intfs.map((o) => (
                  <option key={o.name}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Authentication method">Pre-shared Key</Field>
            <Field label="Pre-shared key" help="Must be identical on both FortiGates.">
              <input className="inp" type="password" value={f.psk} onChange={(e) => up('psk', e.target.value)} />
            </Field>
          </>
        )}
        {step === 3 && (
          <>
            <Field label="Local interface">
              <select className="sel" value={f.localIntf} onChange={(e) => up('localIntf', e.target.value)}>
                {intfs.map((o) => (
                  <option key={o.name}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Local subnets">
              <input className="inp" value={f.local} onChange={(e) => up('local', e.target.value)} />
            </Field>
            <Field label="Remote Subnets">
              <input className="inp" value={f.remote_net} onChange={(e) => up('remote_net', e.target.value)} />
            </Field>
            <Field label="Internet Access">None</Field>
          </>
        )}
        {step === 4 && (
          <div className="walk-lines mono" style={{ fontSize: 12 }}>
            <div>The following will be created:</div>
            <div>· Phase 1 interface "{f.name}": IKEv2, remote {f.remote} via {f.outIntf}, PSK</div>
            <div>· Phase 2 "{f.name}": {f.local} ↔ {f.remote_net}</div>
            <div>· Addresses/groups {f.name}_local, {f.name}_remote</div>
            <div>· Static route {f.remote_net} → {f.name}, and a blackhole route (distance 254) so traffic is never leaked to the internet if the tunnel is down</div>
            <div>· Policies vpn_{f.name}_local ({f.localIntf} → {f.name}) and vpn_{f.name}_remote ({f.name} → {f.localIntf}), NAT off</div>
          </div>
        )}
        <div className="form-footer">
          {step > 1 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              &lt; Back
            </button>
          )}
          {step < 4 ? (
            <button className="btn primary" onClick={nextStep}>
              Next &gt;
            </button>
          ) : (
            <button className="btn primary" onClick={create}>
              Create
            </button>
          )}
          <button className="btn" onClick={() => navigate('vpn-ipsec')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- custom edit ----------

interface P2Form {
  key: string;
  oldKey: string | null;
  src: string;
  dst: string;
  proposal: string[];
  pfs: boolean;
  dhgrp: string[];
  keylife: string;
  auto: boolean;
}

function ProposalRows({ value, choices, onChange }: { value: string[]; choices: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      {value.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <select className="sel md" value={p} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}>
            {choices.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn sm" disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...value, choices.find((c) => !value.includes(c)) ?? choices[0]])}>
        <Plus size={12} /> Add
      </button>
    </div>
  );
}

function DhChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="checks" style={{ gridTemplateColumns: 'repeat(5, 70px)' }}>
      {DH.map((g) => (
        <label key={g}>
          <input type="checkbox" checked={value.includes(g)} onChange={(e) => onChange(e.target.checked ? [...value, g] : value.filter((x) => x !== g))} />
          {g}
        </label>
      ))}
    </div>
  );
}

function TunnelEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const isNew = name === 'new';
  const P1 = def('vpn ipsec phase1-interface');
  const P2 = def('vpn ipsec phase2-interface');
  const e = isNew ? undefined : find(config, 'vpn ipsec phase1-interface', name);
  const s = (n: string) => (e ? str(P1, e.f, n) : (P1.fields.find((x) => x.name === n)?.default as string) ?? '');
  const [f, setF] = useState({
    name: isNew ? '' : name,
    remote: s('remote-gw'),
    intf: s('interface') || 'wan1',
    ver: s('ike-version'),
    mode: s('mode'),
    psk: '',
    proposal: e && list(P1, e.f, 'proposal').length ? list(P1, e.f, 'proposal') : [...P1_DEFAULT_PROPOSALS],
    dhgrp: e ? list(P1, e.f, 'dhgrp') : ['14', '5'],
    keylife: s('keylife'),
    nat: s('nattraversal') === 'enable',
    dpd: s('dpd'),
    comments: s('comments'),
  });
  const [p2, setP2] = useState<P2Form[]>(() =>
    entries(config, 'vpn ipsec phase2-interface')
      .filter((x) => str(P2, x.f, 'phase1name') === name)
      .map((x) => ({
        key: x.key,
        oldKey: x.key,
        src: cidr(str(P2, x.f, 'src-subnet')),
        dst: cidr(str(P2, x.f, 'dst-subnet')),
        proposal: list(P2, x.f, 'proposal').length ? list(P2, x.f, 'proposal') : [...P2_DEFAULT_PROPOSALS],
        pfs: str(P2, x.f, 'pfs') === 'enable',
        dhgrp: list(P2, x.f, 'dhgrp'),
        keylife: str(P2, x.f, 'keylifeseconds'),
        auto: str(P2, x.f, 'auto-negotiate') === 'enable',
      })),
  );
  const [editP2, setEditP2] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const save = () => {
    const key = isNew ? f.name.trim() : name;
    if (isNew && !/^[A-Za-z0-9_-]{1,15}$/.test(key)) return setErr('Name: 1–15 characters.');
    if (isNew && (find(config, 'vpn ipsec phase1-interface', key) || find(config, 'system interface', key))) return setErr('An interface or tunnel with this name already exists.');
    if (!isIp(f.remote)) return setErr('Enter the remote gateway IP address.');
    const psk = f.psk || (e ? str(P1, e.f, 'psksecret') : '');
    if (!psk) return setErr('Enter a pre-shared key.');
    if (!f.dhgrp.length) return setErr('Select at least one Diffie-Hellman group.');
    for (const p of p2) if (!parseIpMask(p.src) || !parseIpMask(p.dst)) return setErr(`Phase 2 "${p.key}": invalid subnet.`);
    const fields: Fields = { interface: f.intf, 'ike-version': f.ver, peertype: 'any', 'net-device': 'disable', proposal: f.proposal, dhgrp: f.dhgrp, 'remote-gw': f.remote, psksecret: psk };
    if (f.ver === '1' && f.mode !== 'main') fields.mode = f.mode;
    if (f.keylife !== '86400') fields.keylife = f.keylife;
    if (!f.nat) fields.nattraversal = 'disable';
    if (f.dpd !== 'on-demand') fields.dpd = f.dpd;
    if (f.comments) fields.comments = f.comments;
    updateConfig(
      (c) => {
        const t1 = tableOf(c, 'vpn ipsec phase1-interface');
        const row = t1.entries.find((x) => x.key === key);
        if (row) row.f = fields;
        else t1.entries.push({ key, f: fields });
        const t2 = tableOf(c, 'vpn ipsec phase2-interface');
        t2.entries = t2.entries.filter((x) => str(P2, x.f, 'phase1name') !== key);
        for (const p of p2) {
          const pf: Fields = { phase1name: key, proposal: p.proposal, dhgrp: p.dhgrp, 'src-subnet': fmtIpMask(parseIpMask(p.src)!), 'dst-subnet': fmtIpMask(parseIpMask(p.dst)!) };
          if (!p.pfs) pf.pfs = 'disable';
          if (p.auto) pf['auto-negotiate'] = 'enable';
          if (p.keylife !== '43200') pf.keylifeseconds = p.keylife;
          t2.entries.push({ key: p.key, f: pf });
        }
      },
      `${isNew ? 'Add' : 'Edit'} vpn.ipsec.phase1-interface ${key}`,
    );
    toast(`Tunnel ${key} saved`);
    navigate('vpn-ipsec');
  };

  const cur = editP2 !== null ? p2[editP2] : null;
  const setCur = (patch: Partial<P2Form>) => setP2(p2.map((x, i) => (i === editP2 ? { ...x, ...patch } : x)));

  return (
    <EditPage title={isNew ? 'New Custom IPsec Tunnel' : `Edit VPN Tunnel: ${name}`} onOk={save} onCancel={() => navigate('vpn-ipsec')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">{isNew ? <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} /> : <b>{name}</b>}</Field>
      <Field label="Comments">
        <input className="inp" value={f.comments} onChange={(e) => up('comments', e.target.value)} />
      </Field>
      <Section title="Network">
        <Field label="Remote Gateway">Static IP Address</Field>
        <Field label="IP Address">
          <input className="inp" value={f.remote} onChange={(e) => up('remote', e.target.value)} />
        </Field>
        <Field label="Interface">
          <select className="sel" value={f.intf} onChange={(e) => up('intf', e.target.value)}>
            {ifaceOptions(config)
              .filter((o) => o.name !== 'ssl.root')
              .map((o) => (
                <option key={o.name}>{o.name}</option>
              ))}
          </select>
        </Field>
        <Field label="NAT Traversal">
          <Toggle on={f.nat} onChange={(v) => up('nat', v)} />
        </Field>
        <Field label="Dead Peer Detection">
          <Seg
            value={f.dpd}
            onChange={(v) => up('dpd', v)}
            options={[
              { v: 'disable', label: 'Disable' },
              { v: 'on-idle', label: 'On Idle' },
              { v: 'on-demand', label: 'On Demand' },
            ]}
          />
        </Field>
      </Section>
      <Section title="Authentication">
        <Field label="Method">Pre-shared Key</Field>
        <Field label="Pre-shared Key" help={e ? 'Leave empty to keep the current key.' : undefined}>
          <input className="inp" type="password" value={f.psk} onChange={(e) => up('psk', e.target.value)} />
        </Field>
        <Field label="IKE Version">
          <Seg
            value={f.ver}
            onChange={(v) => up('ver', v)}
            options={[
              { v: '1', label: '1' },
              { v: '2', label: '2' },
            ]}
          />
        </Field>
        {f.ver === '1' && (
          <Field label="Mode">
            <Seg
              value={f.mode}
              onChange={(v) => up('mode', v)}
              options={[
                { v: 'aggressive', label: 'Aggressive' },
                { v: 'main', label: 'Main (ID protection)' },
              ]}
            />
          </Field>
        )}
      </Section>
      <Section title="Phase 1 Proposal">
        <Field label="Encryption / Authentication">
          <ProposalRows value={f.proposal} choices={P1_PROPOSAL_CHOICES} onChange={(v) => up('proposal', v)} />
        </Field>
        <Field label="Diffie-Hellman Groups">
          <DhChecks value={f.dhgrp} onChange={(v) => up('dhgrp', v)} />
        </Field>
        <Field label="Key Lifetime (seconds)">
          <input className="inp sm" value={f.keylife} onChange={(e) => up('keylife', e.target.value)} />
        </Field>
      </Section>
      <Section title="Phase 2 Selectors">
        <div className="tbl-wrap" style={{ marginBottom: 8 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Local Address</th>
                <th>Remote Address</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p2.map((p, i) => (
                <tr className="row" key={i}>
                  <td>{p.key}</td>
                  <td className="mono">{p.src}</td>
                  <td className="mono">{p.dst}</td>
                  <td>
                    <button className="btn sm" onClick={() => setEditP2(i)}>
                      <Pencil size={12} />
                    </button>{' '}
                    <button className="btn sm" onClick={() => setP2(p2.filter((_, j) => j !== i))}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="btn sm"
          onClick={() => {
            setP2([...p2, { key: (f.name || name) + (p2.length ? `-${p2.length + 1}` : ''), oldKey: null, src: '0.0.0.0/0', dst: '0.0.0.0/0', proposal: [...P2_DEFAULT_PROPOSALS], pfs: true, dhgrp: ['14', '5'], keylife: '43200', auto: false }]);
            setEditP2(p2.length);
          }}
        >
          <Plus size={12} /> Add Phase 2
        </button>
      </Section>
      {cur && (
        <Modal
          title={`Phase 2 Selector: ${cur.key}`}
          wide
          onClose={() => setEditP2(null)}
          footer={
            <button className="btn primary" onClick={() => setEditP2(null)}>
              OK
            </button>
          }
        >
          <Field label="Name">
            <input className="inp" value={cur.key} onChange={(e) => setCur({ key: e.target.value })} />
          </Field>
          <Field label="Local Address" help="Subnet on this side (HQ).">
            <input className="inp" value={cur.src} onChange={(e) => setCur({ src: e.target.value })} />
          </Field>
          <Field label="Remote Address" help="Subnet on the far side (branch).">
            <input className="inp" value={cur.dst} onChange={(e) => setCur({ dst: e.target.value })} />
          </Field>
          <Field label="Encryption / Authentication">
            <ProposalRows value={cur.proposal} choices={P2_PROPOSAL_CHOICES} onChange={(v) => setCur({ proposal: v })} />
          </Field>
          <Field label="Enable Perfect Forward Secrecy (PFS)">
            <Toggle on={cur.pfs} onChange={(v) => setCur({ pfs: v })} />
          </Field>
          {cur.pfs && (
            <Field label="Diffie-Hellman Groups">
              <DhChecks value={cur.dhgrp} onChange={(v) => setCur({ dhgrp: v })} />
            </Field>
          )}
          <Field label="Auto-negotiate">
            <Toggle on={cur.auto} onChange={(v) => setCur({ auto: v })} />
          </Field>
          <Field label="Key Lifetime (seconds)">
            <input className="inp sm" value={cur.keylife} onChange={(e) => setCur({ keylife: e.target.value })} />
          </Field>
        </Modal>
      )}
    </EditPage>
  );
}
