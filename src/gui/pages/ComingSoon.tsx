import { Hammer } from 'lucide-react';
import { useStore } from '../../store';
import { LEAVES } from '../menu';

export function ComingSoon() {
  const page = useStore((s) => s.ui.page);
  const leaf = LEAVES[page];
  return (
    <div className="page">
      <div className="page-title">{leaf ? leaf.label : 'Not found'}</div>
      <div className="coming">
        <h2>
          <Hammer size={20} style={{ verticalAlign: -3 }} /> Planned for a later version (v1.1)
        </h2>
        <p className="muted">
          {leaf?.group} › {leaf?.label} is on the FWallSim roadmap and isn't simulated in v1.0.
        </p>
        {leaf?.learn && (
          <>
            <b>What you will practise here:</b>
            <ul>
              {leaf.learn.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
