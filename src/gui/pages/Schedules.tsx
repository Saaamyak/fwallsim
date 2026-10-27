import { useState } from 'react';
import { navigate, useStore } from '../../store';
import { def, entries, find, list, str } from '../../engine/config';
import { DAYS } from '../../engine/schema';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field, Seg, Toggle } from '../ui';
import { deleteEntry, nameError, saveEntry } from '../save';

const PAGE = 'pol-schedule';

interface Row {
  key: string;
  type: 'recurring' | 'onetime';
  detail: string;
}

export function SchedulesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <ScheduleEdit editKey={editKey} /> : <ScheduleList />;
}

function ScheduleList() {
  const config = useStore((s) => s.config);
  const R = def('firewall schedule recurring');
  const O = def('firewall schedule onetime');
  const rec: Row[] = entries(config, 'firewall schedule recurring').map((e) => {
    const days = list(R, e.f, 'day');
    const st = str(R, e.f, 'start');
    const en = str(R, e.f, 'end');
    const d = days.includes('none') || !days.length ? 'never' : days.length === 7 ? 'every day' : days.map((x) => x.slice(0, 3)).join(', ');
    return { key: e.key, type: 'recurring', detail: `${d}${st === en ? ', all day' : `, ${st} - ${en}`}` };
  });
  const one: Row[] = entries(config, 'firewall schedule onetime').map((e) => ({ key: e.key, type: 'onetime', detail: `${str(O, e.f, 'start')} → ${str(O, e.f, 'end')}` }));
  const cols: Col<Row>[] = [
    { title: 'Name', render: (r) => <Chip kind="sched" name={r.key} /> },
    { title: 'Type', render: (r) => (r.type === 'recurring' ? 'Recurring' : 'One Time') },
    { title: 'Details', render: (r) => r.detail },
  ];
  const path = (r: Row) => (r.type === 'recurring' ? 'firewall schedule recurring' : 'firewall schedule onetime');
  return (
    <div className="page">
      <div className="page-title">Schedules</div>
      <ObjectList<Row>
        groups={[
          { title: 'Recurring Schedule', rows: rec },
          { title: 'One Time Schedule', rows: one },
        ]}
        cols={cols}
        refPathOf={path}
        onCreate={() => navigate(PAGE, 'new')}
        onEdit={(r) => navigate(PAGE, `${r.type}:${r.key}`)}
        canDelete={(r) => (['always', 'none'].includes(r.key) ? `"${r.key}" is built in and cannot be deleted.` : null)}
        onDelete={(r) => deleteEntry(path(r), r.key)}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        A policy only matches while its schedule is active. The simulator uses your computer's clock, so a schedule like "weekdays 09:00–17:00" really is inactive at night.
      </p>
    </div>
  );
}

function toInputDate(fortiDt: string): [string, string] {
  const m = /^(\d{1,2}):(\d{2}) (\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(fortiDt);
  if (!m) return ['', '00:00'];
  return [`${m[3]}-${m[4].padStart(2, '0')}-${m[5].padStart(2, '0')}`, `${m[1].padStart(2, '0')}:${m[2]}`];
}

const fromInputDate = (d: string, t: string) => {
  const [y, mo, da] = d.split('-');
  return `${t} ${y}/${mo}/${da}`;
};

function ScheduleEdit({ editKey }: { editKey: string }) {
  const config = useStore((s) => s.config);
  const isNew = editKey === 'new';
  const [kind0, name] = isNew ? ['recurring', ''] : (editKey.split(/:(.*)/s) as [string, string]);
  const R = def('firewall schedule recurring');
  const O = def('firewall schedule onetime');
  const re = kind0 === 'recurring' && name ? find(config, 'firewall schedule recurring', name) : undefined;
  const oe = kind0 === 'onetime' && name ? find(config, 'firewall schedule onetime', name) : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<'recurring' | 'onetime'>(kind0 as 'recurring' | 'onetime');
  const [n, setN] = useState(name);
  const [days, setDays] = useState<string[]>(re ? list(R, re.f, 'day').filter((d) => d !== 'none') : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  const [start, setStart] = useState(re ? str(R, re.f, 'start') : '09:00');
  const [end, setEnd] = useState(re ? str(R, re.f, 'end') : '17:00');
  const [allDay, setAllDay] = useState(re ? str(R, re.f, 'start') === str(R, re.f, 'end') : false);
  const [os, setOs] = useState(oe ? toInputDate(str(O, oe.f, 'start')) : [today, '00:00']);
  const [oen, setOen] = useState(oe ? toInputDate(str(O, oe.f, 'end')) : [today, '23:59']);
  const [err, setErr] = useState('');

  const save = () => {
    const path = type === 'recurring' ? 'firewall schedule recurring' : 'firewall schedule onetime';
    const ne = nameError(config, path, name || null, n.trim());
    if (ne && !(name && n.trim() === name)) return setErr(ne);
    if (type === 'recurring') {
      saveEntry(path, isNew || kind0 !== 'recurring' ? null : name, n.trim(), { day: days.length ? days : ['none'], ...(allDay ? {} : { start, end }) }, 'Schedule');
    } else {
      if (!os[0] || !oen[0]) return setErr('Enter start and end dates.');
      if (`${os[0]} ${os[1]}` >= `${oen[0]} ${oen[1]}`) return setErr('The end must be after the start.');
      saveEntry(path, isNew || kind0 !== 'onetime' ? null : name, n.trim(), { start: fromInputDate(os[0], os[1]), end: fromInputDate(oen[0], oen[1]) }, 'Schedule');
    }
    navigate(PAGE);
  };

  return (
    <EditPage title={isNew ? 'New Schedule' : `Edit Schedule: ${name}`} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Type">
        {isNew ? (
          <Seg
            value={type}
            onChange={setType}
            options={[
              { v: 'recurring', label: 'Recurring' },
              { v: 'onetime', label: 'One Time' },
            ]}
          />
        ) : type === 'recurring' ? (
          'Recurring'
        ) : (
          'One Time'
        )}
      </Field>
      <Field label="Name">
        <input className="inp" value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
      {type === 'recurring' ? (
        <>
          <Field label="Days">
            <div className="checks" style={{ gridTemplateColumns: 'repeat(4, 110px)' }}>
              {DAYS.map((d) => (
                <label key={d}>
                  <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))} />
                  {d[0].toUpperCase() + d.slice(1, 3)}
                </label>
              ))}
            </div>
          </Field>
          <Field label="All day">
            <Toggle on={allDay} onChange={setAllDay} />
          </Field>
          {!allDay && (
            <>
              <Field label="Start time">
                <input type="time" className="inp sm" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Stop time" help="If the stop time is earlier than the start time, the schedule runs overnight.">
                <input type="time" className="inp sm" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </>
          )}
        </>
      ) : (
        <>
          <Field label="Start date">
            <input type="date" className="inp md" value={os[0]} onChange={(e) => setOs([e.target.value, os[1]])} /> <input type="time" className="inp sm" value={os[1]} onChange={(e) => setOs([os[0], e.target.value])} />
          </Field>
          <Field label="End date">
            <input type="date" className="inp md" value={oen[0]} onChange={(e) => setOen([e.target.value, oen[1]])} /> <input type="time" className="inp sm" value={oen[1]} onChange={(e) => setOen([oen[0], e.target.value])} />
          </Field>
        </>
      )}
    </EditPage>
  );
}
