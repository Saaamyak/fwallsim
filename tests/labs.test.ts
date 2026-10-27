import './stubs';
import * as store from '../src/store';
import { LABS, evaluateLab } from '../src/labs/labs';
import { SOL, cli } from './solutions';
import { parseConfigText, serializeConfig } from '../src/engine/serialize';
import { migrateConfig } from '../src/engine/defaults';

store.login('admin', '', 'pc1');

let bad = 0;
for (const lab of LABS) {
  store.startLab(lab.id);
  const s = store.getState();
  const before = evaluateLab(lab, s.config, s.runtime);
  SOL[lab.id]?.();
  const t = store.getState();
  const after = evaluateLab(lab, t.config, t.runtime);
  const ok = after.every(Boolean) && !before.every(Boolean);
  if (!ok) bad++;
  const mark = (a: boolean[], y: string, n: string) => a.map((b) => (b ? y : n)).join('');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${lab.id.padEnd(16)} start ${mark(before, '✓', '·')}  solved ${mark(after, '✓', '✗')}${after.every(Boolean) ? '' : '  <- ' + lab.tasks.filter((_, i) => !after[i]).map((x) => x.title).join(' | ')}`);
  if (!after.every(Boolean)) console.log('     CLI tail: ' + cli.out.slice(-6).join(' / '));
  // backup/restore round trip: the saved file restores to the same config, and the lab still passes
  const text = serializeConfig(t.config);
  const back = migrateConfig(parseConfigText(text));
  const again = serializeConfig(back);
  const stillOk = evaluateLab(lab, back, t.runtime).every(Boolean);
  if (again !== text || !stillOk) {
    bad++;
    const a = text.split('\n'), b = again.split('\n');
    const i = a.findIndex((l, k) => l !== b[k]);
    console.log(`FAIL  ${lab.id.padEnd(16)} backup/restore round trip${stillOk ? '' : ' (lab fails after restore)'}${i >= 0 ? `: line ${i + 1} "${a[i]}" became "${b[i]}"` : ''}`);
  }
}
console.log(bad ? `${bad} labs need fixing` : `ALL ${LABS.length} LABS SOLVABLE`);
if (bad) process.exit(1);
