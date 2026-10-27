import { useEffect, useMemo, useReducer, useState } from 'react';
import { CheckCircle, Circle, GraduationCap, Lightbulb, RefreshCw, RotateCcw, X } from 'lucide-react';
import { exitLab, markLabComplete, navigate, revealHint, startLab, useStore } from '../store';
import { evaluateLab, LABS } from '../labs/labs';
import { Confirm } from './ui';

export function LabGuide() {
  const training = useStore((s) => s.training);
  const config = useStore((s) => s.config);
  const rt = useStore((s) => s.runtime);
  const [tick, recheck] = useReducer((x: number) => x + 1, 0);
  const [restart, setRestart] = useState(false);
  const lab = LABS.find((l) => l.id === training.active);
  const results = useMemo(() => (lab ? evaluateLab(lab, config, rt) : []), [lab, config, rt.lab, rt.history, rt.trafficLogs, tick]); // eslint-disable-line
  const allDone = results.length > 0 && results.every(Boolean);
  const completed = lab ? !!training.completed[lab.id] : false;

  useEffect(() => {
    if (lab && allDone && !completed) markLabComplete(lab.id);
  }, [lab, allDone, completed]);

  // CLI commands do not change the store, so re-check periodically for CLI-based tasks.
  useEffect(() => {
    const t = setInterval(recheck, 4000);
    return () => clearInterval(t);
  }, []);

  if (!lab) return null;
  const hints = training.hints[lab.id] ?? 0;
  const firstOpen = results.findIndex((r) => !r);

  return (
    <aside className="lab-guide">
      <div className="lab-guide-hdr">
        <GraduationCap size={16} />
        <span className={`badge ${lab.level === 'Challenge' ? 'warn' : 'info'}`}>{lab.level}</span>
        <span style={{ flex: 1 }} />
        <button className="hdr-btn" style={{ color: 'inherit' }} title="Re-check now" onClick={recheck}>
          <RefreshCw size={14} />
        </button>
        <button className="hdr-btn" style={{ color: 'inherit' }} title="Restart lab" onClick={() => setRestart(true)}>
          <RotateCcw size={14} />
        </button>
        <button className="hdr-btn" style={{ color: 'inherit' }} title="Exit lab (keeps the config)" onClick={exitLab}>
          <X size={15} />
        </button>
      </div>
      <div className="lab-guide-body">
        <h3 style={{ margin: '0 0 6px' }}>{lab.title}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {lab.intro}
        </p>
        {allDone && (
          <div className="walk-lines" style={{ borderLeftColor: 'var(--ok)', marginBottom: 10 }}>
            <b className="ok-text">✔ Lab complete!</b>
            <div>
              All tasks pass. <a onClick={() => navigate('training')}>Choose the next lab</a>
            </div>
          </div>
        )}
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 700, margin: '8px 0' }}>
          Tasks ({results.filter(Boolean).length}/{lab.tasks.length})
        </div>
        {lab.tasks.map((t, i) => (
          <div key={i} className={`lab-task ${results[i] ? 'done' : ''} ${i === firstOpen ? 'current' : ''}`}>
            <div style={{ display: 'flex', gap: 8 }}>
              {results[i] ? <CheckCircle size={16} color="var(--ok)" style={{ flex: 'none', marginTop: 1 }} /> : <Circle size={16} color="var(--muted)" style={{ flex: 'none', marginTop: 1 }} />}
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                {(!results[i] || i === firstOpen) && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t.how}</div>}
              </div>
            </div>
          </div>
        ))}
        {lab.hints && (
          <>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 700, margin: '14px 0 8px' }}>Hints</div>
            {lab.hints.slice(0, hints).map((h, i) => (
              <div key={i} className="walk-hint" style={{ marginTop: 6 }}>
                <Lightbulb size={12} style={{ verticalAlign: -2 }} /> {h}
              </div>
            ))}
            {hints < lab.hints.length ? (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => revealHint(lab.id)}>
                <Lightbulb size={12} /> Show hint {hints + 1} of {lab.hints.length}
              </button>
            ) : (
              lab.solution &&
              (hints > lab.hints.length ? (
                <div className="walk-lines" style={{ marginTop: 8 }}>
                  <b>Solution</b>
                  {lab.solution.map((s, i) => (
                    <div key={i}>
                      {i + 1}. {s}
                    </div>
                  ))}
                </div>
              ) : (
                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => revealHint(lab.id)}>
                  Show solution
                </button>
              ))
            )}
          </>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
          Checks run automatically as you change the config or send traffic. Tools: Lab panel (Traffic Generator, Packet Walk, Debug Flow) and the CLI (&gt;_).
        </p>
      </div>
      {restart && (
        <Confirm
          msg="Restart this lab from its starting configuration? Your changes in this lab are lost."
          yesLabel="Restart"
          onNo={() => setRestart(false)}
          onYes={() => {
            startLab(lab.id);
            setRestart(false);
          }}
        />
      )}
    </aside>
  );
}
