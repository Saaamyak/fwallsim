import { useEffect, useReducer, useRef, useState } from 'react';
import { Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { setUi, useStore } from '../store';
import { getCli } from '../cli/session';

export function Cli() {
  const cli = getCli();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [line, setLine] = useState('');
  const [hi, setHi] = useState(-1);
  const [max, setMax] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useStore((s) => s.config); // re-render prompt when hostname changes

  useEffect(() => cli.onChange(force), [cli]);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  });

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      cli.interrupt(line);
      setLine('');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      cli.clear();
      return;
    }
    if (cli.busy) {
      e.preventDefault();
      return;
    }
    if (cli.confirm && (e.key === 'y' || e.key === 'n' || e.key === 'Y' || e.key === 'N')) {
      e.preventDefault();
      cli.submit(e.key);
      setLine('');
      return;
    }
    switch (e.key) {
      case 'Enter':
        cli.submit(line);
        setLine('');
        setHi(-1);
        break;
      case 'Tab':
        e.preventDefault();
        setLine(cli.complete(line));
        break;
      case '?':
        e.preventDefault();
        cli.helpKey(line);
        break;
      case 'ArrowUp': {
        e.preventDefault();
        const n = Math.min(hi + 1, cli.history.length - 1);
        if (n >= 0) {
          setHi(n);
          setLine(cli.history[n]);
        }
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const n = hi - 1;
        setHi(n);
        setLine(n >= 0 ? cli.history[n] : '');
        break;
      }
    }
  };

  const style = max ? { top: 52, right: 12, left: 12, bottom: 12, width: 'auto', height: 'auto' } : undefined;
  return (
    <div className="cli-win" style={style}>
      <div className="bar">
        CLI Console
        <span className="muted" style={{ fontSize: 11, color: '#9aa' }}>
          ? help · Tab complete · ↑↓ history · Ctrl+C stop · Ctrl+L clear
        </span>
        <span style={{ flex: 1 }} />
        <button className="hdr-btn" title="Clear" onClick={() => cli.clear()}>
          <Trash2 size={14} />
        </button>
        <button className="hdr-btn" title={max ? 'Restore' : 'Maximize'} onClick={() => setMax(!max)}>
          {max ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="hdr-btn" title="Close" onClick={() => setUi({ cliOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="console" ref={ref} onClick={() => input.current?.focus()}>
        {cli.out.join('\n')}
        {'\n'}
        <span className="cli-input-line">
          {cli.busy ? '' : cli.prompt()}
          <input
            ref={input}
            className="cli-inline"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={cli.busy ? '' : line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={onKey}
          />
        </span>
      </div>
    </div>
  );
}
