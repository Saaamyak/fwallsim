import { useMemo, useState } from 'react';
import { Download, Plus, Power, Trash2 } from 'lucide-react';
import { firmwareUpgrade, getState, navigate, toast, updateConfig, useStore } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, gobj, list, nextKey, objectOf, str, sub, tableOf } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { fmtIpMask, intToIp, isIp, parseIpMask } from '../../engine/ip';
import { FIRMWARES, NMS_IP, syslogTarget, upgradeBlocked } from '../../engine/mgmt';
import { serializeConfig } from '../../engine/serialize';
import { ObjectList, type Col } from '../ObjectList';
import { ActionCell, ChipList, Confirm, EditPage, Field, Section, Seg, Toggle } from '../ui';
import { addrOptions, EntryPicker, ifaceOptions, kindOfName, schedOptions, svcOptions } from '../picker';

// ---------- Local-In Policy ----------

interface LRow {
  key: string;
  intf: string;
  src: string[];
  dst: string[];
  svc: string[];
  action: string;
  status: boolean;
  comments: string;
}

export function LocalInPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <LocalInEdit id={editKey} /> : <LocalInList />;
}

function LocalInList() {
  const config = useStore((s) => s.config);
  const L = def('firewall local-in-policy');
  const rows: LRow[] = entries(config, 'firewall local-in-policy').map((e) => ({ key: e.key, intf: str(L, e.f, 'intf') || 'any', src: list(L, e.f, 'srcaddr'), dst: list(L, e.f, 'dstaddr'), svc: list(L, e.f, 'service'), action: str(L, e.f, 'action'), status: str(L, e.f, 'status') === 'enable', comments: str(L, e.f, 'comments') }));
  const kind = (n: string) => kindOfName(config, n);
  const cols: Col<LRow>[] = [
    { title: 'ID', render: (r) => r.key },
    { title: 'Interface', render: (r) => r.intf },
    { title: 'Source', render: (r) => <ChipList names={r.src} kindOf={kind} /> },
    { title: 'Destination', render: (r) => <ChipList names={r.dst} kindOf={kind} /> },
    { title: 'Service', render: (r) => <ChipList names={r.svc} kindOf={kind} /> },
    { title: 'Action', render: (r) => <ActionCell action={r.action} /> },
    { title: 'Comments', render: (r) => <span className="muted">{r.comments}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">Local-In Policy</div>
      <ObjectList
        groups={[{ title: '', rows }]}
        cols={cols}
        onCreate={() => navigate('pol-localin', 'new')}
        onEdit={(r) => navigate('pol-localin', r.key)}
        onDelete={(r) => updateConfig((c) => (tableOf(c, 'firewall local-in-policy').entries = entries(c, 'firewall local-in-policy').filter((e) => e.key !== r.key)), `Delete firewall.local-in-policy ${r.key}`)}
        rowClass={(r) => (r.status ? '' : 'disabled')}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Local-in policies control traffic <b>to the FortiGate itself</b> (admin GUI, SSH, ping, SNMP). They are checked before Administrative Access. A typical use: HTTPS admin is enabled on wan1, then a local-in policy denies everyone except your office IP. Firewall policies never apply to this traffic.
      </p>
    </div>
  );
}

function LocalInEdit({ id }: { id: string }) {
  const config = useStore((s) => s.config);
  const isNew = id === 'new';
  const L = def('firewall local-in-policy');
  const e = isNew ? undefined : find(config, 'firewall local-in-policy', id);
  const [f, setF] = useState({
    intf: e ? str(L, e.f, 'intf') : 'wan1',
    src: e ? list(L, e.f, 'srcaddr') : ['all'],
    dst: e ? list(L, e.f, 'dstaddr') : ['all'],
    svc: e ? list(L, e.f, 'service') : ['HTTPS'],
    action: e ? str(L, e.f, 'action') : 'deny',
    schedule: e ? str(L, e.f, 'schedule') || 'always' : 'always',
    status: e ? str(L, e.f, 'status') === 'enable' : true,
    comments: e ? str(L, e.f, 'comments') : '',
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.src.length || !f.dst.length || !f.svc.length) return setErr('Source, destination and service are required.');
    const key = isNew ? nextKey(config, 'firewall local-in-policy') : id;
    const fields: Fields = { intf: f.intf, srcaddr: f.src, dstaddr: f.dst, action: f.action, service: f.svc, schedule: f.schedule };
    if (!f.status) fields.status = 'disable';
    if (f.comments) fields.comments = f.comments;
    const ok = updateConfig(
      (c) => {
        const t = tableOf(c, 'firewall local-in-policy');
        const row = t.entries.find((x) => x.key === key);
        if (row) row.f = fields;
        else t.entries.push({ key, f: fields });
      },
      `${isNew ? 'Add' : 'Edit'} firewall.local-in-policy ${key}`,
    );
    if (ok) {
      toast(`Local-in policy ${key} saved`);
      navigate('pol-localin');
    }
  };
  return (
    <EditPage title={isNew ? 'New Local-In Policy' : `Edit Local-In Policy ${id}`} onOk={save} onCancel={() => navigate('pol-localin')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Interface">
        <select className="sel" value={f.intf} onChange={(e) => up('intf', e.target.value)}>
          {ifaceOptions(config, { any: true, zones: true }).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Source" help="Who is trying to reach the FortiGate.">
        <EntryPicker value={f.src} options={addrOptions(config)} onChange={(v) => up('src', v)} />
      </Field>
      <Field label="Destination" help="The FortiGate's own address (all = any of its addresses).">
        <EntryPicker value={f.dst} options={addrOptions(config)} onChange={(v) => up('dst', v)} />
      </Field>
      <Field label="Service">
        <EntryPicker value={f.svc} options={svcOptions(config)} onChange={(v) => up('svc', v)} />
      </Field>
      <Field label="Schedule">
        <select className="sel" value={f.schedule} onChange={(e) => up('schedule', e.target.value)}>
          {schedOptions(config).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Action">
        <Seg
          className="action"
          value={f.action}
          onChange={(v) => up('action', v)}
          options={[
            { v: 'accept', label: 'ACCEPT' },
            { v: 'deny', label: 'DENY', cls: 'deny' },
          ]}
        />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={f.comments} onChange={(e) => up('comments', e.target.value)} />
      </Field>
      <Field label="Enable this policy">
        <Toggle on={f.status} onChange={(v) => up('status', v)} />
      </Field>
    </EditPage>
  );
}

// ---------- SNMP ----------

export function SnmpPage() {
  const config = useStore((s) => s.config);
  const C = def('system snmp community');
  const H = C.fields.find((x) => x.name === 'hosts')!.sub!;
  const g = (n: string) => gobj(config, 'system snmp sysinfo', n);
  const [agent, setAgent] = useState({ status: g('status') === 'enable', description: g('description'), contact: g('contact-info'), location: g('location') });
  const [coms, setComs] = useState(
    entries(config, 'system snmp community').map((e) => ({
      name: str(C, e.f, 'name'),
      enabled: str(C, e.f, 'status') === 'enable',
      v2c: str(C, e.f, 'query-v2c-status') === 'enable',
      hosts: (sub(e.f, 'hosts')?.entries ?? []).map((h) => {
        const n = parseIpMask(str(H, h.f, 'ip'));
        return n ? `${intToIp(n.ip)}/${n.prefix}` : '';
      }),
    })),
  );
  const dmz = useMemo(() => buildNet(config).ifs['dmz'], [config]);

  const apply = () => {
    for (const c of coms) {
      if (!c.name.trim()) return toast('Each community needs a name.', 'err');
      for (const h of c.hosts) if (h && !parseIpMask(h)) return toast(`Invalid host "${h}".`, 'err');
    }
    const ok = updateConfig((c) => {
      const o = objectOf(c, 'system snmp sysinfo').f;
      o.status = agent.status ? 'enable' : 'disable';
      o.description = agent.description;
      o['contact-info'] = agent.contact;
      o.location = agent.location;
      c['system snmp community'] = {
        kind: 'table',
        entries: coms.map((x, i) => ({
          key: String(i + 1),
          f: {
            name: x.name.trim(),
            ...(x.enabled ? {} : { status: 'disable' }),
            ...(x.v2c ? {} : { 'query-v2c-status': 'disable' }),
            hosts: { kind: 'table', entries: x.hosts.filter((h) => h.trim()).map((h, k) => ({ key: String(k + 1), f: { ip: fmtIpMask(parseIpMask(h)!) } })) },
          },
        })),
      };
    }, 'Edit system.snmp');
    if (ok) toast('SNMP settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">SNMP</div>
      <div className="form-card">
        <Section title={<Toggle on={agent.status} onChange={(v) => setAgent({ ...agent, status: v })} label="SNMP Agent" />}>
          <Field label="Description">
            <input className="inp" value={agent.description} onChange={(e) => setAgent({ ...agent, description: e.target.value })} />
          </Field>
          <Field label="Location">
            <input className="inp" value={agent.location} onChange={(e) => setAgent({ ...agent, location: e.target.value })} />
          </Field>
          <Field label="Contact Info">
            <input className="inp" value={agent.contact} onChange={(e) => setAgent({ ...agent, contact: e.target.value })} />
          </Field>
        </Section>
        <Section title="SNMP v1/v2c communities">
          {coms.map((x, i) => {
            const upd = (p: Partial<typeof x>) => setComs(coms.map((y, j) => (j === i ? { ...y, ...p } : y)));
            return (
              <div key={i} style={{ border: '1px solid var(--border)', padding: 8, marginBottom: 8, marginLeft: 220 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="inp md" value={x.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Community name" />
                  <Toggle on={x.enabled} onChange={(v) => upd({ enabled: v })} label="Enabled" />
                  <Toggle on={x.v2c} onChange={(v) => upd({ v2c: v })} label="v2c queries" />
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" onClick={() => setComs(coms.filter((_, j) => j !== i))}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Hosts (empty = any):</span>
                  {x.hosts.map((h, k) => (
                    <div key={k} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input className="inp md" value={h} onChange={(e) => upd({ hosts: x.hosts.map((y, j) => (j === k ? e.target.value : y)) })} placeholder={`${NMS_IP}/32`} />
                      <button className="btn sm" onClick={() => upd({ hosts: x.hosts.filter((_, j) => j !== k) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button className="btn sm" style={{ marginTop: 4 }} onClick={() => upd({ hosts: [...x.hosts, `${NMS_IP}/32`] })}>
                    <Plus size={12} /> Add host
                  </button>
                </div>
              </div>
            );
          })}
          <div style={{ marginLeft: 220 }}>
            <button className="btn sm" onClick={() => setComs([...coms, { name: 'fwallsim-ro', enabled: true, v2c: true, hosts: [`${NMS_IP}/32`] }])}>
              <Plus size={12} /> Create New community
            </button>
          </div>
        </Section>
        <p className="muted" style={{ paddingLeft: 220 }}>
          SNMP also needs <b>SNMP</b> in Administrative Access on the interface the manager comes in on (dmz: {dmz?.allowaccess.includes('snmp') ? 'enabled' : 'not enabled'}). Test it from Lab &gt; Mgmt.
        </p>
        <div className="form-footer">
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Remote logging (used inside Log Settings) ----------

export function RemoteSyslogSection() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const g = (n: string) => gobj(config, 'log syslogd setting', n);
  const [f, setF] = useState({ status: g('status') === 'enable', server: g('server'), port: g('port'), mode: g('mode') });
  const target = useMemo(() => syslogTarget(config, buildNet(config)), [config, lab]); // eslint-disable-line
  const apply = () => {
    if (f.status && !isIp(f.server)) return toast('Enter the syslog server IP address.', 'err');
    if (!(/^\d+$/.test(f.port) && Number(f.port) >= 1 && Number(f.port) <= 65535)) return toast('Syslog port must be 1–65535.', 'err');
    const ok = updateConfig((c) => {
      const o = objectOf(c, 'log syslogd setting').f;
      o.status = f.status ? 'enable' : 'disable';
      o.server = f.server;
      o.port = f.port;
      o.mode = f.mode;
    }, 'Edit log.syslogd.setting');
    if (ok) toast('Remote logging settings applied');
  };
  return (
    <>
      <div className="section-title">Remote Logging and Archiving</div>
      <Field label="Send logs to syslog">
        <Toggle on={f.status} onChange={(v) => setF({ ...f, status: v })} />
      </Field>
      <Field label="IP Address/FQDN" help={`Lab NMS-Server: ${NMS_IP} (UDP/514)`}>
        <input className="inp md" value={f.server} onChange={(e) => setF({ ...f, server: e.target.value })} placeholder={NMS_IP} />
      </Field>
      <Field label="Port">
        <input className="inp sm" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />
      </Field>
      <Field label="Mode">
        <Seg
          value={f.mode}
          onChange={(v) => setF({ ...f, mode: v })}
          options={[
            { v: 'udp', label: 'UDP' },
            { v: 'reliable', label: 'Reliable (TCP)' },
          ]}
        />
      </Field>
      <Field label="Connection status">
        <span className={target.ok ? 'ok-text' : g('status') === 'enable' ? 'err-text' : 'muted'}>{target.reason}</span>
      </Field>
      <Field label="">
        <button className="btn primary sm" onClick={apply}>
          Apply remote logging
        </button>
      </Field>
    </>
  );
}

// ---------- Firmware ----------

export function FirmwarePage() {
  const fw = useStore((s) => s.runtime.firmware) ?? { version: '7.4.4', build: '2662' };
  const host = useStore((s) => gobj(s.config, 'system global', 'hostname'));
  const [pick, setPick] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);
  const download = () => {
    const blob = new Blob([serializeConfig(getState().config)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${host}_v${fw.version}_before_upgrade.conf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="page">
      <div className="page-title">Firmware & Registration</div>
      <div className="form-card">
        <Field label="Current version">
          <b>
            FortiOS v{fw.version} build{fw.build}
          </b>{' '}
          <span className="badge ok">{FIRMWARES.find((x) => x.version === fw.version)?.label}</span>
        </Field>
        <Field label="Registration">
          <span className="ok-text">Registered (simulated)</span>
        </Field>
        <Section title="Available firmware">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Build</th>
                  <th>Type</th>
                  <th>Upgrade path</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {FIRMWARES.map((x) => {
                  const blocked = upgradeBlocked(fw.version, x.version);
                  return (
                    <tr className="row" key={x.version}>
                      <td>
                        <b>v{x.version}</b>
                      </td>
                      <td>{x.build}</td>
                      <td>{x.label}</td>
                      <td className={blocked ? 'muted' : 'ok-text'} style={{ fontSize: 12 }}>
                        {blocked ?? 'Direct upgrade supported'}
                      </td>
                      <td>
                        <button className="btn sm primary" disabled={!!blocked} onClick={() => setPick(x.version)}>
                          Upgrade
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
        <p className="muted">Best practice before any upgrade: read the release notes, check the upgrade path, back up the configuration, and plan a maintenance window (the unit reboots).</p>
      </div>
      {pick && (
        <Confirm
          yesLabel="Confirm and Upgrade"
          onNo={() => setPick(null)}
          onYes={() => {
            if (backup) download();
            const err = firmwareUpgrade(pick);
            if (err) toast(err, 'err');
            setPick(null);
          }}
          msg={
            <>
              <p>
                Upgrade from v{fw.version} to <b>v{pick}</b>? The device will reboot.
              </p>
              <Toggle on={backup} onChange={setBackup} label={<span><Download size={12} /> Back up config before upgrade</span>} />
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                <Power size={12} /> Sessions are dropped during the reboot.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}
