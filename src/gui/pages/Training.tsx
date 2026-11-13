import { useEffect, useState } from 'react';
import { CheckCircle, Clock, FileText, GraduationCap, Play } from 'lucide-react';
import { getState, navigate, resetTraining, startLab, useStore } from '../../store';
import { LABS, type Level } from '../../labs/labs';
import { classNo, classPdf, COURSE_PLAN_PDF } from '../../labs/classes';
import { serializeConfig } from '../../engine/serialize';
import { factoryConfig, migrateConfig } from '../../engine/defaults';
import type { Config } from '../../engine/types';
import { Confirm, Toggle } from '../ui';

const LEVELS: { level: Level; desc: string }[] = [
  { level: 'Beginner', desc: 'First steps: GUI, policies, NAT, logs, objects, publishing a server.' },
  { level: 'Intermediate', desc: 'Policy order, renumbering, admin hardening, identity-based access.' },
  { level: 'Advanced', desc: 'VPNs, SD-WAN and dynamic routing.' },
  { level: 'Challenge', desc: 'Something is broken. You get the symptom only: find and fix the fault with the Packet Walk, logs and debug tools.' },
];

/** The config text without things that differ on every fresh unit (random UUIDs, the admin password). */
function comparable(c: Config): string {
  const copy: Config = { ...c };
  delete copy['system admin'];
  return serializeConfig(copy)
    .split('\n')
    .filter((l) => !/^\s*set uuid /.test(l))
    .join('\n');
}

/** True when the learner has changed the configuration since the factory default. */
function changedFromFactory(c: Config): boolean {
  return comparable(c) !== comparable(migrateConfig(factoryConfig()));
}

const NEXT_LAB_EVENT = 'fwallsim:next-lab';

/** Open Labs & Challenges and bring the next unfinished lab into view (used by "Choose the next lab"). */
export function openNextLab() {
  navigate('training');
  // after the page has opened (and scrolled to the top), point at the card
  setTimeout(() => window.dispatchEvent(new Event(NEXT_LAB_EVENT)), 50);
}

/** The first unfinished lab after the current one, else the first unfinished lab at all. */
function nextLabId(): string | null {
  const { active, completed } = getState().training;
  const from = Math.max(0, LABS.findIndex((l) => l.id === active) + 1);
  const open = (l: (typeof LABS)[number]) => !completed[l.id];
  return (LABS.slice(from).find(open) ?? LABS.find(open))?.id ?? null;
}

export function TrainingPage() {
  const training = useStore((s) => s.training);
  const [pick, setPick] = useState<string | null>(null);
  const [backup, setBackup] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    const show = () => {
      const id = nextLabId();
      if (!id) return;
      document.getElementById(`lab-card-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(id);
      clearTimeout(timer);
      timer = window.setTimeout(() => setFlash(null), 2500);
    };
    window.addEventListener(NEXT_LAB_EVENT, show);
    return () => {
      window.removeEventListener(NEXT_LAB_EVENT, show);
      clearTimeout(timer);
    };
  }, []);
  const done = Object.keys(training.completed).filter((id) => LABS.some((l) => l.id === id)).length;
  const lab = LABS.find((l) => l.id === pick);

  const start = () => {
    if (backup) {
      const blob = new Blob([serializeConfig(getState().config)], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my_config_before_lab.conf';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    startLab(pick!);
    setPick(null);
  };

  return (
    <div className="page">
      <div className="page-title">
        <GraduationCap size={22} /> Labs &amp; Challenges
      </div>
      <div className="widget" style={{ marginBottom: 14 }}>
        <div className="widget-body" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div>
            <div className="big-num">
              {done} / {LABS.length}
            </div>
            <div className="muted">completed</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="bar">
              <div style={{ width: `${(done / LABS.length) * 100}%` }} />
            </div>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Each lab loads its own starting configuration and opens a guide beside the GUI. Tasks tick automatically when the config and real simulated traffic prove they work. Work in the GUI, the CLI or both.
            </p>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Every lab also has a printable class handout with click-by-click steps and screenshots.{' '}
              <a href={COURSE_PLAN_PDF} target="_blank" rel="noopener">
                <FileText size={12} style={{ verticalAlign: -2 }} /> Course plan (PDF)
              </a>
            </p>
          </div>
          {done > 0 && (
            <button className="btn sm" onClick={resetTraining}>
              Reset progress
            </button>
          )}
        </div>
      </div>
      {LEVELS.map(({ level, desc }) => (
        <div key={level} style={{ marginBottom: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            {level === 'Challenge' ? 'Troubleshooting challenges' : `${level} labs`}
            <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 10 }}>
              {desc}
            </span>
          </div>
          <div className="widgets">
            {LABS.filter((l) => l.level === level).map((l, i) => {
              const completed = !!training.completed[l.id];
              const active = training.active === l.id;
              return (
                <div
                  key={l.id}
                  id={`lab-card-${l.id}`}
                  className="widget"
                  style={flash === l.id ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent)' } : active ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-soft)' } : undefined}
                >
                  <div className="widget-hdr">
                    {completed ? <CheckCircle size={15} color="var(--ok)" /> : <span className="muted">{i + 1}.</span>}
                    {l.title}
                  </div>
                  <div className="widget-body">
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      <Clock size={12} style={{ verticalAlign: -2 }} /> ~{l.minutes} min · {l.topic}
                    </div>
                    <div style={{ fontSize: 13, marginBottom: 10 }}>{l.intro}</div>
                    <button className={`btn sm ${active ? '' : 'primary'}`} onClick={() => {
                        setBackup(changedFromFactory(getState().config));
                        setPick(l.id);
                      }}>
                      <Play size={12} /> {active ? 'Restart' : completed ? 'Do again' : 'Start'}
                    </button>
                    <a
                      className="btn sm"
                      style={{ marginLeft: 8, color: 'inherit', textDecoration: 'none' }}
                      href={classPdf(l.id) ?? undefined}
                      target="_blank"
                      rel="noopener"
                      title={`Class ${classNo(l.id)} handout (PDF, opens in a new tab)`}
                    >
                      <FileText size={12} /> Class PDF
                    </a>
                    {active && <span className="badge info" style={{ marginLeft: 8 }}>in progress</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {lab && (
        <Confirm
          yesLabel="Start lab"
          onNo={() => setPick(null)}
          onYes={start}
          msg={
            <>
              <p>
                Start <b>{lab.title}</b>? This replaces the current configuration with the lab's starting point. Your administrator accounts and passwords are kept.
              </p>
              <Toggle on={backup} onChange={setBackup} label="Download a backup of my current configuration first" />
            </>
          }
        />
      )}
    </div>
  );
}
