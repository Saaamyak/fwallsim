import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { navigate, toast, updateConfig, useStore } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, list, objectOf, str, sub } from '../../engine/config';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Section, Toggle } from '../ui';
import { addrOptions, EntryPicker, ifaceOptions, userOptions } from '../picker';
import { deleteEntry, nameError, saveEntry } from '../save';

const BUILTIN = ['full-access', 'tunnel-access', 'web-access'];

export function SslPortalsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <PortalEdit name={editKey === 'new' ? '' : editKey} /> : <PortalList />;
}

function PortalList() {
  const config = useStore((s) => s.config);
  const W = def('vpn ssl web portal');
  const rows = entries(config, 'vpn ssl web portal').map((e) => ({ key: e.key, tunnel: str(W, e.f, 'tunnel-mode') === 'enable', web: str(W, e.f, 'web-mode') === 'enable', split: str(W, e.f, 'split-tunneling') === 'enable', pools: list(W, e.f, 'ip-pools') }));
  const yes = (b: boolean) => (b ? <span className="badge ok">Enabled</span> : <span className="badge grey">Disabled</span>);
  const cols: Col<(typeof rows)[number]>[] = [
    { title: 'Name', render: (r) => <b>{r.key}</b> },
    { title: 'Tunnel Mode', render: (r) => yes(r.tunnel) },
    { title: 'Web Mode', render: (r) => yes(r.web) },
    { title: 'Split Tunneling', render: (r) => (r.tunnel ? yes(r.split) : '') },
    { title: 'IP Pools', render: (r) => r.pools.join(', ') },
  ];
  return (
    <div className="page">
      <div className="page-title">SSL-VPN Portals</div>
      <ObjectList groups={[{ title: '', rows }]} cols={cols} refPathOf={() => 'vpn ssl web portal'} onCreate={() => navigate('vpn-sslportal', 'new')} onEdit={(r) => navigate('vpn-sslportal', r.key)} onDelete={(r) => deleteEntry('vpn ssl web portal', r.key)} canDelete={(r) => (BUILTIN.includes(r.key) ? 'Built-in portals cannot be deleted.' : null)} />
      <p className="muted" style={{ marginTop: 10 }}>
        A portal decides what a VPN user gets: <b>tunnel mode</b> (FortiClient, full network access) and/or <b>web mode</b> (browser bookmarks only). With split tunneling, only traffic to company networks enters the tunnel.
      </p>
    </div>
  );
}

function PortalEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const W = def('vpn ssl web portal');
  const e = name ? find(config, 'vpn ssl web portal', name) : undefined;
  const s = (n: string) => (e ? str(W, e.f, n) : (W.fields.find((x) => x.name === n)?.default as string) ?? '');
  const [f, setF] = useState({ name, tunnel: e ? s('tunnel-mode') === 'enable' : true, web: s('web-mode') === 'enable', split: s('split-tunneling') === 'enable', pools: e ? list(W, e.f, 'ip-pools') : ['SSLVPN_TUNNEL_ADDR1'], routes: e ? list(W, e.f, 'split-tunneling-routing-address') : [] });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const save = () => {
    const ne = nameError(config, 'vpn ssl web portal', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const fields: Fields = {};
    if (f.tunnel) {
      fields['tunnel-mode'] = 'enable';
      if (f.pools.length) fields['ip-pools'] = f.pools;
      if (!f.split) fields['split-tunneling'] = 'disable';
      if (f.split && f.routes.length) fields['split-tunneling-routing-address'] = f.routes;
    }
    if (f.web) fields['web-mode'] = 'enable';
    saveEntry('vpn ssl web portal', name || null, f.name.trim(), fields, 'Portal');
    navigate('vpn-sslportal');
  };
  return (
    <EditPage title={name ? `Edit SSL-VPN Portal: ${name}` : 'New SSL-VPN Portal'} onOk={save} onCancel={() => navigate('vpn-sslportal')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">{name ? <b>{name}</b> : <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />}</Field>
      <Section title={<Toggle on={f.tunnel} onChange={(v) => up('tunnel', v)} label="Tunnel Mode" />}>
        {f.tunnel && (
          <>
            <Field label="Enable Split Tunneling" help="On: only traffic to company networks enters the tunnel. Off: all of the laptop's traffic goes through the FortiGate.">
              <Toggle on={f.split} onChange={(v) => up('split', v)} />
            </Field>
            {f.split && (
              <Field label="Routing Address Override" help="Leave empty to use the destinations of the ssl.root firewall policies.">
                <EntryPicker value={f.routes} options={addrOptions(config)} onChange={(v) => up('routes', v)} />
              </Field>
            )}
            <Field label="Source IP Pools" help="Addresses handed to FortiClient (an IP range address object).">
              <EntryPicker value={f.pools} options={addrOptions(config)} onChange={(v) => up('pools', v)} />
            </Field>
          </>
        )}
      </Section>
      <Section title={<Toggle on={f.web} onChange={(v) => up('web', v)} label="Enable Web Mode" />}>{f.web && <p className="muted">Web mode bookmarks are not simulated.</p>}</Section>
    </EditPage>
  );
}

export function SslSettingsPage() {
  const config = useStore((s) => s.config);
  const S = def('vpn ssl settings');
  const R = S.fields.find((x) => x.name === 'authentication-rule')!.sub!;
  const o = config['vpn ssl settings']?.kind === 'object' ? config['vpn ssl settings'].f : {};
  const [f, setF] = useState({
    status: str(S, o, 'status') === 'enable',
    intf: list(S, o, 'source-interface'),
    port: str(S, o, 'port'),
    pools: list(S, o, 'tunnel-ip-pools'),
    restrict: list(S, o, 'source-address'),
    def: str(S, o, 'default-portal'),
  });
  const [rules, setRules] = useState((sub(o, 'authentication-rule')?.entries ?? []).map((r) => ({ who: [...list(R, r.f, 'users'), ...list(R, r.f, 'groups')], portal: str(R, r.f, 'portal') })));
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const portals = entries(config, 'vpn ssl web portal').map((p) => p.key);
  const adminPort = (config['system global']?.kind === 'object' && (config['system global'].f['admin-sport'] as string)) || '443';

  const apply = () => {
    const port = Number(f.port);
    if (!(port >= 1 && port <= 65535)) return toast('Port must be 1–65535.', 'err');
    if (rules.some((r) => !r.who.length || !r.portal)) return toast('Each authentication rule needs users/groups and a portal.', 'err');
    updateConfig((c) => {
      const t = objectOf(c, 'vpn ssl settings').f;
      t.status = f.status ? 'enable' : 'disable';
      t['source-interface'] = f.intf;
      t.port = String(port);
      t['tunnel-ip-pools'] = f.pools;
      t['source-address'] = f.restrict;
      if (f.def) t['default-portal'] = f.def;
      else delete t['default-portal'];
      t['authentication-rule'] = {
        kind: 'table',
        entries: rules.map((r, i) => {
          const users = r.who.filter((w) => entries(c, 'user local').some((u) => u.key === w));
          const groups = r.who.filter((w) => !users.includes(w));
          return { key: String(i + 1), f: { ...(groups.length ? { groups } : {}), ...(users.length ? { users } : {}), portal: r.portal } };
        }),
      };
    }, 'Edit vpn.ssl.settings');
    toast('SSL-VPN settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">SSL-VPN Settings</div>
      <div className="form-card">
        <Section title="Connection Settings">
          <Field label="Enable SSL-VPN">
            <Toggle on={f.status} onChange={(v) => up('status', v)} />
          </Field>
          <Field label="Listen on Interface(s)">
            <EntryPicker value={f.intf} options={ifaceOptions(config).filter((x) => x.name !== 'ssl.root')} onChange={(v) => up('intf', v)} />
          </Field>
          <Field label="Listen on Port" help={Number(f.port) === Number(adminPort) ? `Warning: ${f.port} is also the HTTPS admin port. Use e.g. 10443.` : undefined}>
            <input className="inp sm" value={f.port} onChange={(e) => up('port', e.target.value)} />
          </Field>
          <Field label="Restrict Access" help="Empty = allow access from any host.">
            <EntryPicker value={f.restrict} options={addrOptions(config)} onChange={(v) => up('restrict', v)} />
          </Field>
          <Field label="Server Certificate">Fortinet_Factory</Field>
        </Section>
        <Section title="Tunnel Mode Client Settings">
          <Field label="Address Range" help="Default pool used when the portal has none.">
            <EntryPicker value={f.pools} options={addrOptions(config)} onChange={(v) => up('pools', v)} />
          </Field>
        </Section>
        <Section title="Authentication/Portal Mapping">
          {rules.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, paddingLeft: 220 }}>
              <EntryPicker value={r.who} options={userOptions(config)} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, who: v } : x)))} />
              <select className="sel md" value={r.portal} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, portal: e.target.value } : x)))}>
                <option value="">Portal…</option>
                {portals.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <button className="btn sm" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div style={{ paddingLeft: 220, marginBottom: 10 }}>
            <button className="btn sm" onClick={() => setRules([...rules, { who: [], portal: 'tunnel-access' }])}>
              <Plus size={12} /> Create New rule
            </button>
          </div>
          <Field label="All Other Users/Groups">
            <select className="sel md" value={f.def} onChange={(e) => up('def', e.target.value)}>
              <option value="">(none)</option>
              {portals.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        </Section>
        <p className="muted" style={{ paddingLeft: 220 }}>
          Users also need a firewall policy from <b>ssl.root</b> that includes them, or login is refused.
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
