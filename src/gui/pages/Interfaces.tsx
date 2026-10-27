import { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Layers, Network } from 'lucide-react';
import { navigate, toast, updateConfig, useStore } from '../../store';
import type { Config, ConfigEntry, ConfigTable } from '../../engine/types';
import { def, entries, find, findRefs, list, newUuid, nextKey, str, sub, tableOf, gobj } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { fmtCidr, fmtIpMask, inNet, intToIp, ipToInt, isIp, netAddr, parseIpMask, prefixToMask } from '../../engine/ip';
import { ALLOWACCESS } from '../../engine/schema';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Section, Seg, Toggle } from '../ui';
import { EntryPicker, ifaceOptions } from '../picker';

const PAGE = 'net-interfaces';
const ACCESS_LABEL: Record<string, string> = {
  https: 'HTTPS',
  http: 'HTTP',
  ping: 'PING',
  fgfm: 'FMG-Access',
  ssh: 'SSH',
  snmp: 'SNMP',
  telnet: 'TELNET',
  ftm: 'FTM',
  'radius-acct': 'RADIUS Accounting',
  fabric: 'Security Fabric Connection',
  'probe-response': 'Probe Response',
  'speed-test': 'Speed Test',
};

interface Row {
  key: string;
  kind: 'intf' | 'zone';
  type: string;
  up: boolean;
  adminUp: boolean;
  ip: string;
  members: string[];
  access: string[];
  alias: string;
  role: string;
  dhcpClients: number;
  parent?: string;
}

export function InterfacesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  if (editKey?.startsWith('zone:')) return <ZoneEdit name={editKey.slice(5)} />;
  if (editKey) return <InterfaceEdit name={editKey} />;
  return <InterfaceList />;
}

function InterfaceList() {
  const config = useStore((s) => s.config);
  const net = useMemo(() => buildNet(config), [config]);
  const I = def('system interface');
  const rows: Row[] = entries(config, 'system interface')
    .filter((e) => !net.ifs[e.key]?.memberOf)
    .map((e) => {
      const st = net.ifs[e.key];
      return {
        key: e.key,
        kind: 'intf',
        type: str(I, e.f, 'type'),
        up: st.up,
        adminUp: st.adminUp,
        ip: st.ipStr ? `${st.ipStr} ${prefixToMask(st.prefix)}${st.mode === 'dhcp' ? ' (DHCP)' : ''}` : st.mode === 'dhcp' ? '0.0.0.0 (DHCP: no lease)' : '0.0.0.0 0.0.0.0',
        members: st.members,
        access: st.allowaccess,
        alias: st.alias,
        role: st.role,
        dhcpClients: net.hosts.filter((h) => h.dhcp && h.ok && h.logical === e.key).length,
        parent: st.parent,
      };
    });
  const zones: Row[] = entries(config, 'system zone').map((z) => ({
    key: z.key,
    kind: 'zone',
    type: 'zone',
    up: true,
    adminUp: true,
    ip: '',
    members: list(def('system zone'), z.f, 'interface'),
    access: [],
    alias: '',
    role: '',
    dhcpClients: 0,
  }));
  const typeLabel: Record<string, string> = { physical: 'Physical Interface', 'hard-switch': 'Hardware Switch', vlan: 'VLAN', tunnel: 'Tunnel Interface', loopback: 'Loopback Interface', aggregate: '802.3ad Aggregate' };
  const order = ['physical', 'hard-switch', 'vlan', 'tunnel', 'loopback'];
  const groups = [
    ...order.map((t) => ({ title: typeLabel[t], rows: rows.filter((r) => r.type === t) })).filter((g) => g.rows.length),
    ...(zones.length ? [{ title: 'Zone', rows: zones }] : []),
  ];

  const cols: Col<Row>[] = [
    {
      title: 'Name',
      render: (r) => (
        <span className="chip">
          {r.kind === 'zone' ? <Layers size={14} color="#8e5bb5" /> : r.up ? <ArrowUpCircle size={14} color="var(--ok)" /> : <ArrowDownCircle size={14} color={r.adminUp ? '#9aa5a7' : 'var(--err)'} />}
          <b>{r.key}</b>
          {r.alias && <span className="muted">({r.alias})</span>}
        </span>
      ),
    },
    { title: 'Type', render: (r) => (r.kind === 'zone' ? 'Zone' : typeLabel[r.type] ?? r.type) + (r.parent ? ` (${r.parent})` : '') },
    {
      title: 'Members',
      render: (r) => (
        <div className="chips">
          {r.members.map((m) => (
            <span key={m} className="chip">
              <Network size={13} color="#3b7dbf" />
              {m}
            </span>
          ))}
        </div>
      ),
    },
    { title: 'IP/Netmask', render: (r) => <span className="mono">{r.ip}</span> },
    { title: 'Role', render: (r) => (r.role && r.role !== 'undefined' ? r.role.toUpperCase() : r.kind === 'zone' ? '' : 'Undefined') },
    { title: 'Administrative Access', render: (r) => r.access.map((a) => ACCESS_LABEL[a] ?? a).join(', ') },
    { title: 'DHCP Clients', className: 'num', render: (r) => (r.kind === 'intf' ? r.dhcpClients : '') },
  ];

  return (
    <div className="page">
      <div className="page-title">Interfaces</div>
      <ObjectList<Row>
        groups={groups}
        cols={cols}
        refPathOf={(r) => (r.kind === 'zone' ? 'system zone' : 'system interface')}
        createMenu={[
          { label: 'Interface', onClick: () => navigate(PAGE, 'new') },
          { label: 'Zone', onClick: () => navigate(PAGE, 'zone:') },
        ]}
        onEdit={(r) => navigate(PAGE, r.kind === 'zone' ? `zone:${r.key}` : r.key)}
        canDelete={(r) => (r.kind === 'intf' && r.type !== 'vlan' && r.type !== 'loopback' ? 'Physical, hardware-switch and tunnel interfaces cannot be deleted.' : null)}
        onDelete={(r) =>
          updateConfig(
            (c) => {
              if (r.kind === 'zone') tableOf(c, 'system zone').entries = entries(c, 'system zone').filter((e) => e.key !== r.key);
              else {
                tableOf(c, 'system interface').entries = entries(c, 'system interface').filter((e) => e.key !== r.key);
                tableOf(c, 'system dhcp server').entries = entries(c, 'system dhcp server').filter((e) => str(def('system dhcp server'), e.f, 'interface') !== r.key);
              }
            },
            `Delete ${r.kind === 'zone' ? 'system.zone' : 'system.interface'} ${r.key}`,
          )
        }
        rowClass={(r) => (r.adminUp ? '' : 'disabled')}
        search={(r, q) => `${r.key} ${r.alias} ${r.ip}`.toLowerCase().includes(q)}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Tip: double-click an interface to edit it. Interfaces used by policies, routes or DHCP servers show a Ref. count and cannot be deleted until those references are removed.
      </p>
    </div>
  );
}

// ---------- interface edit ----------

interface DhcpForm {
  enabled: boolean;
  start: string;
  end: string;
  netmask: string;
  gwMode: 'same' | 'specify';
  gw: string;
  dnsMode: 'default' | 'local' | 'specify';
  dns1: string;
  lease: string;
}

function dhcpFor(c: Config, iface: string): { entry?: ConfigEntry; form: DhcpForm } {
  const D = def('system dhcp server');
  const R = D.fields.find((x) => x.name === 'ip-range')!.sub!;
  const entry = entries(c, 'system dhcp server').find((e) => str(D, e.f, 'interface') === iface);
  if (!entry) return { form: { enabled: false, start: '', end: '', netmask: '', gwMode: 'same', gw: '', dnsMode: 'default', dns1: '', lease: '604800' } };
  const r = sub(entry.f, 'ip-range')?.entries[0];
  const gw = str(D, entry.f, 'default-gateway');
  return {
    entry,
    form: {
      enabled: str(D, entry.f, 'status') === 'enable',
      start: r ? str(R, r.f, 'start-ip') : '',
      end: r ? str(R, r.f, 'end-ip') : '',
      netmask: str(D, entry.f, 'netmask'),
      gwMode: gw === '0.0.0.0' ? 'same' : 'specify',
      gw,
      dnsMode: str(D, entry.f, 'dns-service') as DhcpForm['dnsMode'],
      dns1: str(D, entry.f, 'dns-server1'),
      lease: str(D, entry.f, 'lease-time'),
    },
  };
}

function InterfaceEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const isNew = name === 'new';
  const I = def('system interface');
  const e = isNew ? undefined : find(config, 'system interface', name);
  const net = useMemo(() => buildNet(config), [config]);
  const st = e ? net.ifs[e.key] : undefined;
  const s = (n: string) => (e ? str(I, e.f, n) : (I.fields.find((x) => x.name === n)?.default as string) ?? '');
  const type = isNew ? 'vlan' : s('type');

  const [f, setF] = useState(() => ({
    name: isNew ? '' : name,
    alias: s('alias'),
    role: isNew ? 'lan' : s('role'),
    mode: s('mode'),
    ip: (() => {
      const n = parseIpMask(s('ip'));
      return n && n.ip ? fmtCidr(n) : '';
    })(),
    access: e ? list(I, e.f, 'allowaccess') : ['ping'],
    status: s('status'),
    description: s('description'),
    parent: s('interface') || 'internal',
    vlanid: isNew ? '' : s('vlanid'),
    defaultgw: s('defaultgw') === 'enable',
    distance: s('distance'),
    devid: s('device-identification') === 'enable',
    createAddr: false,
    remoteIp: (() => {
      const n = parseIpMask(s('remote-ip'));
      return n && n.ip ? fmtCidr(n) : '';
    })(),
  }));
  const [dhcp, setDhcp] = useState<DhcpForm>(() => dhcpFor(config, name).form);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const isMember = !!st?.memberOf;
  const canAddress = type !== 'tunnel' && !isMember;
  const isIpsecTunnel = type === 'tunnel' && !!s('interface');

  const validate = (): Record<string, string> => {
    const er: Record<string, string> = {};
    if (isNew) {
      if (!/^[A-Za-z0-9_.-]{1,15}$/.test(f.name)) er.name = 'Name is required (max 15 characters: letters, digits, _ - .).';
      else if (find(config, 'system interface', f.name) || find(config, 'system zone', f.name)) er.name = 'An interface or zone with this name already exists.';
      const v = Number(f.vlanid);
      if (!(v >= 1 && v <= 4094)) er.vlanid = 'VLAN ID must be between 1 and 4094.';
      else if (entries(config, 'system interface').some((x) => str(I, x.f, 'type') === 'vlan' && str(I, x.f, 'interface') === f.parent && str(I, x.f, 'vlanid') === f.vlanid))
        er.vlanid = `VLAN ID ${v} is already used on ${f.parent}.`;
    }
    if (canAddress && f.mode === 'static' && f.ip.trim()) {
      const n = parseIpMask(f.ip);
      if (!n || n.prefix === 32 || n.prefix === 0) er.ip = 'Enter a valid IP/netmask, for example 192.168.10.1/24.';
      else if (netAddr(n.ip, n.prefix) === n.ip) er.ip = 'This is the network address of the subnet. Use a host address.';
      else if (gobj(config, 'system settings', 'allow-subnet-overlap') !== 'enable') {
        const clash = net.ifList.find((o) => o.name !== name && o.ip !== null && !o.memberOf && (inNet(n.ip, o.ip, Math.min(o.prefix, n.prefix)) || inNet(o.ip, n.ip, Math.min(o.prefix, n.prefix))));
        if (clash) er.ip = `IP address is in same subnet as the others (${clash.name} ${clash.ipStr}/${clash.prefix}).`;
      }
    }
    if (dhcp.enabled && canAddress) {
      const n = parseIpMask(f.ip);
      if (f.mode !== 'static' || !n) er.dhcp = 'The DHCP server needs a static interface IP.';
      else if (!isIp(dhcp.start) || !isIp(dhcp.end) || ipToInt(dhcp.start)! > ipToInt(dhcp.end)!) er.dhcp = 'Enter a valid start and end address.';
      else if (!inNet(ipToInt(dhcp.start)!, n.ip, n.prefix) || !inNet(ipToInt(dhcp.end)!, n.ip, n.prefix)) er.dhcp = 'The address range must be inside the interface subnet.';
      else if (dhcp.gwMode === 'specify' && !isIp(dhcp.gw)) er.dhcp = 'Enter a valid default gateway.';
    }
    return er;
  };

  const save = () => {
    const er = validate();
    setErrs(er);
    if (Object.keys(er).length) return toast('Please fix the highlighted fields.', 'err');
    const key = isNew ? f.name : name;
    updateConfig(
      (c) => {
        let row = find(c, 'system interface', key);
        if (!row) {
          row = { key, f: { vdom: 'root', type: 'vlan', interface: f.parent, vlanid: f.vlanid } };
          tableOf(c, 'system interface').entries.push(row);
        }
        const set = (k: string, v: string | string[] | undefined) => {
          if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete row!.f[k];
          else row!.f[k] = v;
        };
        set('alias', f.alias);
        set('description', f.description);
        set('role', f.role);
        set('status', f.status);
        set('device-identification', f.devid ? 'enable' : 'disable');
        if (isIpsecTunnel) {
          const n = parseIpMask(f.ip);
          const rn = parseIpMask(f.remoteIp);
          set('ip', n ? fmtIpMask(n) : undefined);
          set('remote-ip', rn ? fmtIpMask(rn) : undefined);
          set('allowaccess', f.access);
        }
        if (canAddress) {
          set('mode', f.mode);
          const n = parseIpMask(f.ip);
          set('ip', f.mode === 'static' && n ? fmtIpMask(n) : undefined);
          set('allowaccess', f.access);
          if (f.mode === 'dhcp') {
            set('defaultgw', f.defaultgw ? 'enable' : 'disable');
            set('distance', f.distance);
          }
          // DHCP server
          const D = def('system dhcp server');
          const t = tableOf(c, 'system dhcp server');
          let srv = t.entries.find((x) => str(D, x.f, 'interface') === key);
          if (dhcp.enabled && n && f.mode === 'static') {
            if (!srv) {
              srv = { key: nextKey(c, 'system dhcp server'), f: { interface: key } };
              t.entries.push(srv);
            }
            srv.f['status'] = 'enable';
            srv.f['ip-range'] = { kind: 'table', entries: [{ key: '1', f: { 'start-ip': dhcp.start, 'end-ip': dhcp.end } }] } as ConfigTable;
            srv.f['netmask'] = prefixToMask(n.prefix);
            srv.f['default-gateway'] = dhcp.gwMode === 'same' ? intToIp(n.ip) : dhcp.gw;
            srv.f['dns-service'] = dhcp.dnsMode;
            if (dhcp.dnsMode === 'specify') srv.f['dns-server1'] = dhcp.dns1;
            else delete srv.f['dns-server1'];
            srv.f['lease-time'] = dhcp.lease || '604800';
          } else if (srv) srv.f['status'] = 'disable';
          if (f.createAddr && n && f.mode === 'static') {
            const an = `${key} address`;
            const at = tableOf(c, 'firewall address');
            const existing = at.entries.find((x) => x.key === an);
            const subnet = `${intToIp(netAddr(n.ip, n.prefix))} ${prefixToMask(n.prefix)}`;
            if (existing) existing.f.subnet = subnet;
            else at.entries.push({ key: an, f: { uuid: newUuid(), subnet, 'associated-interface': key } });
          }
        }
      },
      `${isNew ? 'Add' : 'Edit'} system.interface ${key}`,
    );
    toast(`Interface ${key} saved`);
    navigate(PAGE);
  };

  return (
    <EditPage
      title={isNew ? 'New Interface' : `Edit Interface: ${name}`}
      onOk={save}
      onCancel={() => navigate(PAGE)}
      side={
        st && (
          <div className="side-card">
            <h4>Status</h4>
            <div className="kv">
              <span>Link</span>
              <span>{st.link ? <span className="ok-text">Up</span> : 'No cable'}</span>
              <span>Admin</span>
              <span>{st.adminUp ? 'Up' : <span className="err-text">Down</span>}</span>
              <span>IP</span>
              <span className="mono">{st.ipStr ? `${st.ipStr}/${st.prefix}` : '-'}</span>
              {st.mode === 'dhcp' && st.dhcpGw && (
                <>
                  <span>DHCP gateway</span>
                  <span className="mono">{st.dhcpGw}</span>
                </>
              )}
              <span>References</span>
              <span>{findRefs(config, 'system interface', name).length}</span>
            </div>
            {isMember && <p className="muted">This port is a member of hardware switch "{st.memberOf}". Configure the IP address on {st.memberOf}.</p>}
          </div>
        )
      }
    >
      <Field label="Name" err={errs.name}>
        {isNew ? <input className={`inp ${errs.name ? 'bad' : ''}`} value={f.name} onChange={(e) => up('name', e.target.value)} placeholder="e.g. VLAN10" /> : <b>{name}</b>}
      </Field>
      <Field label="Alias">
        <input className="inp" value={f.alias} onChange={(e) => up('alias', e.target.value)} />
      </Field>
      <Field label="Type">{isNew ? 'VLAN' : type === 'hard-switch' ? 'Hardware Switch' : type === 'physical' ? 'Physical Interface' : type}</Field>
      {(isNew || type === 'vlan') && (
        <>
          <Field label="Interface" help="Parent interface the VLAN is tagged on">
            {isNew ? (
              <select className="sel" value={f.parent} onChange={(e) => up('parent', e.target.value)}>
                {ifaceOptions(config)
                  .filter((o) => o.name !== 'ssl.root')
                  .map((o) => (
                    <option key={o.name}>{o.name}</option>
                  ))}
              </select>
            ) : (
              f.parent
            )}
          </Field>
          <Field label="VLAN ID" err={errs.vlanid}>
            {isNew ? <input className={`inp sm ${errs.vlanid ? 'bad' : ''}`} value={f.vlanid} onChange={(e) => up('vlanid', e.target.value)} /> : f.vlanid}
          </Field>
        </>
      )}
      {type === 'hard-switch' && st && <Field label="Interface members">{st.members.join(', ')}</Field>}
      {canAddress && (
        <Field label="Role" help="The role only changes which options the GUI shows (as on a real unit). Policies decide what traffic is allowed.">
          <select className="sel" value={f.role} onChange={(e) => up('role', e.target.value)}>
            <option value="lan">LAN</option>
            <option value="wan">WAN</option>
            <option value="dmz">DMZ</option>
            <option value="undefined">Undefined</option>
          </select>
        </Field>
      )}

      {canAddress && (
        <Section title="Address">
          <Field label="Addressing mode">
            <Seg
              value={f.mode}
              onChange={(v) => up('mode', v)}
              options={[
                { v: 'static', label: 'Manual' },
                { v: 'dhcp', label: 'DHCP' },
              ]}
            />
          </Field>
          {f.mode === 'static' ? (
            <>
              <Field label="IP/Netmask" err={errs.ip} help="Format: 192.168.1.99/24 or 192.168.1.99 255.255.255.0">
                <input className={`inp ${errs.ip ? 'bad' : ''}`} value={f.ip} onChange={(e) => up('ip', e.target.value)} placeholder="0.0.0.0/0.0.0.0" />
              </Field>
              <Field label="Create address object matching subnet">
                <Toggle on={f.createAddr} onChange={(v) => up('createAddr', v)} label={f.createAddr ? `Creates "${f.name || name} address"` : ''} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Status">{st?.ipStr ? <span className="ok-text">Connected: {st.ipStr}/{st.prefix}</span> : <span className="muted">Waiting for a DHCP server…</span>}</Field>
              <Field label="Retrieve default gateway from server">
                <Toggle on={f.defaultgw} onChange={(v) => up('defaultgw', v)} />
              </Field>
              <Field label="Distance">
                <input className="inp sm" value={f.distance} onChange={(e) => up('distance', e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Administrative Access" help="Which management protocols the FortiGate answers on this interface (local-in traffic).">
            <div className="checks">
              {ALLOWACCESS.filter((a) => a !== 'probe-response').map((a) => (
                <label key={a}>
                  <input type="checkbox" checked={f.access.includes(a)} onChange={(e) => up('access', e.target.checked ? [...f.access, a] : f.access.filter((x) => x !== a))} />
                  {ACCESS_LABEL[a]}
                </label>
              ))}
            </div>
          </Field>
        </Section>
      )}

      {isIpsecTunnel && (
        <Section title="Address (tunnel)">
          <Field label="IP" help="Optional. Needed for dynamic routing (OSPF/BGP) over the tunnel or to ping the far end, e.g. 169.254.1.1/32.">
            <input className="inp" value={f.ip} onChange={(e) => up('ip', e.target.value)} placeholder="169.254.1.1/32" />
          </Field>
          <Field label="Remote IP/Netmask" help="Address of the peer's tunnel end, e.g. 169.254.1.2/30.">
            <input className="inp" value={f.remoteIp} onChange={(e) => up('remoteIp', e.target.value)} placeholder="169.254.1.2/30" />
          </Field>
          <Field label="Administrative Access">
            <div className="checks">
              {['ping', 'https', 'ssh'].map((a) => (
                <label key={a}>
                  <input type="checkbox" checked={f.access.includes(a)} onChange={(e) => up('access', e.target.checked ? [...f.access, a] : f.access.filter((x) => x !== a))} />
                  {ACCESS_LABEL[a]}
                </label>
              ))}
            </div>
          </Field>
        </Section>
      )}

      {canAddress && f.mode === 'static' && (
        <Section title={<Toggle on={dhcp.enabled} onChange={(v) => setDhcp({ ...dhcp, enabled: v, ...(v && !dhcp.start ? suggestRange(f.ip) : {}) })} label="DHCP Server" />}>
          {dhcp.enabled && (
            <>
              {errs.dhcp && <p className="err-text">{errs.dhcp}</p>}
              <Field label="Address range">
                <input className="inp md" value={dhcp.start} onChange={(e) => setDhcp({ ...dhcp, start: e.target.value })} /> - <input className="inp md" value={dhcp.end} onChange={(e) => setDhcp({ ...dhcp, end: e.target.value })} />
              </Field>
              <Field label="Default gateway">
                <Seg
                  value={dhcp.gwMode}
                  onChange={(v) => setDhcp({ ...dhcp, gwMode: v })}
                  options={[
                    { v: 'same', label: 'Same as Interface IP' },
                    { v: 'specify', label: 'Specify' },
                  ]}
                />
                {dhcp.gwMode === 'specify' && (
                  <div style={{ marginTop: 6 }}>
                    <input className="inp md" value={dhcp.gw} onChange={(e) => setDhcp({ ...dhcp, gw: e.target.value })} />
                  </div>
                )}
              </Field>
              <Field label="DNS server">
                <Seg
                  value={dhcp.dnsMode}
                  onChange={(v) => setDhcp({ ...dhcp, dnsMode: v })}
                  options={[
                    { v: 'default', label: 'Same as System DNS' },
                    { v: 'local', label: 'Same as Interface IP' },
                    { v: 'specify', label: 'Specify' },
                  ]}
                />
                {dhcp.dnsMode === 'specify' && (
                  <div style={{ marginTop: 6 }}>
                    <input className="inp md" value={dhcp.dns1} onChange={(e) => setDhcp({ ...dhcp, dns1: e.target.value })} placeholder="8.8.8.8" />
                  </div>
                )}
              </Field>
              <Field label="Lease time (seconds)">
                <input className="inp sm" value={dhcp.lease} onChange={(e) => setDhcp({ ...dhcp, lease: e.target.value })} />
              </Field>
            </>
          )}
        </Section>
      )}

      <Section title="Network">
        <Field label="Device detection">
          <Toggle on={f.devid} onChange={(v) => up('devid', v)} />
        </Field>
      </Section>

      <Field label="Comments">
        <textarea className="inp" maxLength={255} value={f.description} onChange={(e) => up('description', e.target.value)} />
      </Field>
      <Field label="Status">
        <Seg
          value={f.status}
          onChange={(v) => up('status', v)}
          options={[
            { v: 'up', label: 'Enabled' },
            { v: 'down', label: 'Disabled' },
          ]}
        />
      </Field>
    </EditPage>
  );
}

function suggestRange(ip: string): Partial<DhcpForm> {
  const n = parseIpMask(ip);
  if (!n || n.prefix > 30) return {};
  const base = netAddr(n.ip, n.prefix);
  const size = 2 ** (32 - n.prefix);
  let start = base + 1;
  if (start === n.ip) start++;
  let end = base + size - 2;
  if (end === n.ip) end--;
  return { start: intToIp(start), end: intToIp(end) };
}

// ---------- zone edit ----------

function ZoneEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const isNew = name === '';
  const Z = def('system zone');
  const e = isNew ? undefined : find(config, 'system zone', name);
  const [zn, setZn] = useState(name);
  const [members, setMembers] = useState<string[]>(e ? list(Z, e.f, 'interface') : []);
  const [block, setBlock] = useState(e ? str(Z, e.f, 'intrazone') === 'deny' : true);
  const [desc, setDesc] = useState(e ? str(Z, e.f, 'description') : '');
  const [err, setErr] = useState('');

  const otherZoned = new Set(entries(config, 'system zone').filter((z) => z.key !== name).flatMap((z) => list(Z, z.f, 'interface')));
  const options = ifaceOptions(config).filter((o) => !otherZoned.has(o.name) && o.name !== 'ssl.root');

  const save = () => {
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(zn)) return setErr('Name is required (max 15 characters).');
    if (isNew && (find(config, 'system zone', zn) || find(config, 'system interface', zn))) return setErr('An interface or zone with this name already exists.');
    const used = members.filter((m) => !(e && list(Z, e.f, 'interface').includes(m)) && findRefs(config, 'system interface', m).some((r) => r.path === 'firewall policy'));
    if (used.length) return setErr(`Interface ${used.join(', ')} is used directly by a firewall policy. Remove it from the policies first, as on a real FortiGate.`);
    updateConfig(
      (c) => {
        let row = find(c, 'system zone', name);
        if (!row) {
          row = { key: zn, f: {} };
          tableOf(c, 'system zone').entries.push(row);
        }
        row.f.interface = members;
        row.f.intrazone = block ? 'deny' : 'allow';
        if (desc) row.f.description = desc;
        else delete row.f.description;
      },
      `${isNew ? 'Add' : 'Edit'} system.zone ${zn}`,
    );
    toast(`Zone ${zn} saved`);
    navigate(PAGE);
  };

  return (
    <EditPage title={isNew ? 'New Zone' : `Edit Zone: ${name}`} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">{isNew ? <input className="inp" value={zn} onChange={(e) => setZn(e.target.value)} /> : <b>{name}</b>}</Field>
      <Field label="Block intra-zone traffic" help="When on, traffic between interfaces of this zone needs a policy. When off, it is allowed without one.">
        <Toggle on={block} onChange={setBlock} />
      </Field>
      <Field label="Interface members">
        <EntryPicker value={members} options={options} onChange={setMembers} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
    </EditPage>
  );
}
