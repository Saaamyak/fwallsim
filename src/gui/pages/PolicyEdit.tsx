import { useState } from 'react';
import { Check, Ban } from 'lucide-react';
import { clearPolicyCounters, navigate, toast, updateConfig, useStore } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, list, newUuid, nextKey, str, tableOf } from '../../engine/config';
import { addrOptions, EntryPicker, ifaceOptions, poolOptions, schedOptions, svcOptions, userOptions } from '../picker';
import { EditPage, Field, Section, Seg, Toggle, fmtAgo, fmtBytes, fmtTime } from '../ui';
import { POLICY_PAGE } from './Policies';

export function PolicyEdit({ editKey }: { editKey: string }) {
  const config = useStore((s) => s.config);
  const stats = useStore((s) => s.runtime.policyStats);
  const sessions = useStore((s) => s.runtime.sessions);
  const isNew = editKey.startsWith('new');
  const [, where, anchor] = isNew ? editKey.split(':') : [];
  const P = def('firewall policy');
  const e = isNew ? undefined : find(config, 'firewall policy', editKey);
  const s = (n: string) => (e ? str(P, e.f, n) : '');
  const l = (n: string) => (e ? list(P, e.f, n) : []);

  const [f, setF] = useState(() => ({
    name: s('name'),
    srcintf: l('srcintf'),
    dstintf: l('dstintf'),
    srcaddr: [...l('srcaddr'), ...l('users'), ...l('groups')],
    dstaddr: l('dstaddr'),
    srcNeg: s('srcaddr-negate') === 'enable',
    dstNeg: s('dstaddr-negate') === 'enable',
    schedule: e ? s('schedule') || 'always' : 'always',
    service: l('service'),
    svcNeg: s('service-negate') === 'enable',
    action: e ? s('action') : 'accept',
    mode: e ? s('inspection-mode') : 'flow',
    nat: e ? s('nat') === 'enable' : true,
    ippool: s('ippool') === 'enable',
    poolname: l('poolname'),
    fixedport: s('fixedport') === 'enable',
    logtraffic: e ? s('logtraffic') : 'utm',
    logStart: s('logtraffic-start') === 'enable',
    comments: s('comments'),
    status: e ? s('status') === 'enable' : true,
  }));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const ifOpts = ifaceOptions(config, { any: true, zones: true });
  const hasVip = f.dstaddr.some((d) => entries(config, 'firewall vip').some((v) => v.key === d) || entries(config, 'firewall vipgrp').some((v) => v.key === d));

  const save = () => {
    const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = 'Name is required.';
    else if (entries(config, 'firewall policy').some((x) => x.key !== editKey && str(P, x.f, 'name') === f.name.trim())) er.name = 'A policy with this name already exists.';
    if (!f.srcintf.length) er.srcintf = 'Select at least one incoming interface.';
    if (!f.dstintf.length) er.dstintf = 'Select at least one outgoing interface.';
    const isUser = (n: string) => entries(config, 'user local').some((x) => x.key === n);
    const isGroup = (n: string) => entries(config, 'user group').some((x) => x.key === n);
    const srcAddrs = f.srcaddr.filter((n) => !isUser(n) && !isGroup(n));
    const srcUsers = f.srcaddr.filter(isUser);
    const srcGroups = f.srcaddr.filter(isGroup);
    if (!srcAddrs.length) er.srcaddr = 'Select at least one source address (users and groups are added in addition to an address).';
    if (!f.dstaddr.length) er.dstaddr = 'Select at least one destination address.';
    if (!f.service.length) er.service = 'Select at least one service.';
    if (f.nat && f.ippool && !f.poolname.length) er.pool = 'Select an IP pool or use the outgoing interface address.';
    setErrs(er);
    if (Object.keys(er).length) return toast('Please fill in the required fields.', 'err');

    const key = isNew ? nextKey(config, 'firewall policy') : editKey;
    const fields: Fields = {
      name: f.name.trim(),
      uuid: (e && str(P, e.f, 'uuid')) || newUuid(),
      srcintf: f.srcintf,
      dstintf: f.dstintf,
      action: f.action,
      srcaddr: srcAddrs,
      dstaddr: f.dstaddr,
      schedule: f.schedule,
      service: f.service,
    };
    const opt = (k: string, on: boolean, val = 'enable') => on && (fields[k] = val);
    if (srcUsers.length) fields.users = srcUsers;
    if (srcGroups.length) fields.groups = srcGroups;
    opt('srcaddr-negate', f.srcNeg);
    opt('dstaddr-negate', f.dstNeg);
    opt('service-negate', f.svcNeg);
    if (f.action === 'accept') {
      opt('inspection-mode', f.mode === 'proxy', 'proxy');
      fields['ssl-ssh-profile'] = e ? str(P, e.f, 'ssl-ssh-profile') : 'no-inspection';
      opt('nat', f.nat);
      if (f.nat) {
        opt('ippool', f.ippool);
        if (f.ippool) fields.poolname = f.poolname;
        opt('fixedport', f.fixedport);
      }
      if (f.logtraffic !== 'utm') fields.logtraffic = f.logtraffic;
      opt('logtraffic-start', f.logStart && f.logtraffic === 'all');
    } else {
      if (f.logtraffic !== 'utm') fields.logtraffic = f.logtraffic;
    }
    opt('status', !f.status, 'disable');
    if (f.comments) fields.comments = f.comments;

    updateConfig(
      (c) => {
        const t = tableOf(c, 'firewall policy');
        const existing = t.entries.find((x) => x.key === key);
        if (existing) existing.f = fields;
        else {
          const row = { key, f: fields };
          const idx = anchor ? t.entries.findIndex((x) => x.key === anchor) : -1;
          if (idx >= 0) t.entries.splice(where === 'before' ? idx : idx + 1, 0, row);
          else t.entries.push(row);
        }
      },
      `${isNew ? 'Add' : 'Edit'} firewall.policy ${key}`,
    );
    toast(`Policy ${key} "${f.name}" saved`);
    navigate(POLICY_PAGE);
  };

  const st = e ? stats[editKey] : undefined;
  const side = e && (
    <div className="side-card">
      <h4>Statistics (since last reset)</h4>
      <div className="kv">
        <span>ID</span>
        <span>{editKey}</span>
        <span>Last used</span>
        <span>{st?.last ? fmtAgo(st.last) : 'N/A'}</span>
        <span>First used</span>
        <span>{st?.first ? fmtTime(st.first) : 'N/A'}</span>
        <span>Active sessions</span>
        <span>{sessions.filter((x) => String(x.policyid) === editKey).length}</span>
        <span>Hit count</span>
        <span>{st?.hits ?? 0}</span>
        <span>Total bytes</span>
        <span>{fmtBytes(st?.bytes ?? 0)}</span>
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => clearPolicyCounters(editKey)}>
        Clear Counters
      </button>
      <h4 style={{ marginTop: 16 }}>UUID</h4>
      <div className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
        {str(P, e.f, 'uuid')}
      </div>
    </div>
  );

  return (
    <EditPage title={isNew ? 'New Policy' : `Edit Policy ${editKey}`} onOk={save} onCancel={() => navigate(POLICY_PAGE)} side={side}>
      <Field label="Name" err={errs.name}>
        <input className={`inp ${errs.name ? 'bad' : ''}`} maxLength={35} value={f.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Incoming Interface" err={errs.srcintf}>
        <EntryPicker value={f.srcintf} options={ifOpts} onChange={(v) => up('srcintf', v)} />
      </Field>
      <Field label="Outgoing Interface" err={errs.dstintf}>
        <EntryPicker value={f.dstintf} options={ifOpts} onChange={(v) => up('dstintf', v)} />
      </Field>
      <Field label="Source" err={errs.srcaddr} help="Addresses, plus optional users or user groups. With users/groups, only logged-in users match (identity-based policy).">
        <EntryPicker value={f.srcaddr} options={[...addrOptions(config), ...userOptions(config)]} onChange={(v) => up('srcaddr', v)} />
      </Field>
      <Field label="Negate Source">
        <Toggle on={f.srcNeg} onChange={(v) => up('srcNeg', v)} />
      </Field>
      <Field label="Destination" err={errs.dstaddr} help={hasVip ? 'Destination includes a VIP: inbound traffic to the VIP external IP is translated to the mapped server address.' : 'To publish a server, choose its Virtual IP here.'}>
        <EntryPicker value={f.dstaddr} options={addrOptions(config, { vip: true })} onChange={(v) => up('dstaddr', v)} />
      </Field>
      <Field label="Negate Destination">
        <Toggle on={f.dstNeg} onChange={(v) => up('dstNeg', v)} />
      </Field>
      <Field label="Schedule">
        <select className="sel" value={f.schedule} onChange={(e) => up('schedule', e.target.value)}>
          {schedOptions(config).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Service" err={errs.service}>
        <EntryPicker value={f.service} options={svcOptions(config)} onChange={(v) => up('service', v)} />
      </Field>
      <Field label="Negate Service">
        <Toggle on={f.svcNeg} onChange={(v) => up('svcNeg', v)} />
      </Field>
      <Field label="Action">
        <Seg
          className="action"
          value={f.action}
          onChange={(v) => up('action', v)}
          options={[
            {
              v: 'accept',
              label: (
                <>
                  <Check size={13} style={{ verticalAlign: -2 }} /> ACCEPT
                </>
              ),
            },
            {
              v: 'deny',
              cls: 'deny',
              label: (
                <>
                  <Ban size={13} style={{ verticalAlign: -2 }} /> DENY
                </>
              ),
            },
          ]}
        />
      </Field>

      {f.action === 'accept' && (
        <>
          <Field label="Inspection Mode">
            <Seg
              value={f.mode}
              onChange={(v) => up('mode', v)}
              options={[
                { v: 'flow', label: 'Flow-based' },
                { v: 'proxy', label: 'Proxy-based' },
              ]}
            />
          </Field>
          <Section title="Firewall / Network Options">
            <Field label="NAT" help="Source NAT: hide the internal source IP behind the outgoing interface address or an IP pool.">
              <Toggle on={f.nat} onChange={(v) => up('nat', v)} />
            </Field>
            {f.nat && (
              <>
                <Field label="IP Pool Configuration" err={errs.pool}>
                  <Seg
                    value={f.ippool ? 'pool' : 'intf'}
                    onChange={(v) => up('ippool', v === 'pool')}
                    options={[
                      { v: 'intf', label: 'Use Outgoing Interface Address' },
                      { v: 'pool', label: 'Use Dynamic IP Pool' },
                    ]}
                  />
                  {f.ippool && (
                    <div style={{ marginTop: 6 }}>
                      <EntryPicker value={f.poolname} options={poolOptions(config)} onChange={(v) => up('poolname', v)} />
                    </div>
                  )}
                </Field>
                <Field label="Preserve Source Port">
                  <Toggle on={f.fixedport} onChange={(v) => up('fixedport', v)} />
                </Field>
              </>
            )}
            <Field label="Protocol Options">
              <span className="muted">default</span>
            </Field>
          </Section>
          <Section title="Security Profiles">
            {['AntiVirus', 'Web Filter', 'DNS Filter', 'Application Control', 'IPS', 'File Filter'].map((p) => (
              <Field key={p} label={p}>
                <Toggle on={false} disabled label={<span className="muted">not simulated yet (later)</span>} />
              </Field>
            ))}
            <Field label="SSL Inspection">
              <span className="muted">{e ? str(P, e.f, 'ssl-ssh-profile') : 'no-inspection'}</span>
            </Field>
          </Section>
          <Section title="Logging Options">
            <Field label="Log Allowed Traffic" help={f.logtraffic === 'utm' ? 'Security Events: only sessions with a security-profile event are logged. Plain allowed traffic will NOT appear in Forward Traffic logs.' : undefined}>
              <Toggle on={f.logtraffic !== 'disable'} onChange={(v) => up('logtraffic', v ? 'utm' : 'disable')} />
              {f.logtraffic !== 'disable' && (
                <div style={{ marginTop: 6 }}>
                  <Seg
                    value={f.logtraffic}
                    onChange={(v) => up('logtraffic', v)}
                    options={[
                      { v: 'utm', label: 'Security Events' },
                      { v: 'all', label: 'All Sessions' },
                    ]}
                  />
                </div>
              )}
            </Field>
            {f.logtraffic === 'all' && (
              <Field label="Generate Logs when Session Starts">
                <Toggle on={f.logStart} onChange={(v) => up('logStart', v)} />
              </Field>
            )}
          </Section>
        </>
      )}
      {f.action === 'deny' && (
        <Section title="Logging Options">
          <Field label="Log Violation Traffic">
            <Toggle on={f.logtraffic !== 'disable'} onChange={(v) => up('logtraffic', v ? 'all' : 'disable')} />
          </Field>
        </Section>
      )}
      <Field label="Comments">
        <textarea className="inp" maxLength={1023} value={f.comments} onChange={(e) => up('comments', e.target.value)} />
        <div className="help">{f.comments.length}/1023</div>
      </Field>
      <Field label="Enable this policy">
        <Toggle on={f.status} onChange={(v) => up('status', v)} />
      </Field>
    </EditPage>
  );
}
