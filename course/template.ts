// HTML building blocks for the FWallSim Class PDFs.

export interface Quiz {
  q: string;
  options: string[];
  answer: number; // index into options
  why: string;
}

export interface ClassDoc {
  no: number;
  slug: string;
  title: string;
  subtitle: string;
  minutes: number;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  goals: string[];
  before: string; // prerequisites
  body: string; // HTML built with the helpers below
  quiz: Quiz[];
  terms: [string, string][];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Screenshot path for an image captured by capture.course.ts. */
export const img = (cls: number, name: string) => `../img/c${String(cls).padStart(2, '0')}/${name}.png`;

export const h = {
  section: (title: string, html: string) => `<section><h2>${title}</h2>${html}</section>`,
  p: (html: string) => `<p>${html}</p>`,
  concept: (html: string) => `<div class="box concept"><div class="box-t">The idea</div>${html}</div>`,
  why: (html: string) => `<div class="box why"><div class="box-t">Why it matters</div>${html}</div>`,
  tip: (html: string) => `<div class="box tip"><div class="box-t">Tip</div>${html}</div>`,
  warn: (html: string) => `<div class="box warn"><div class="box-t">Watch out</div>${html}</div>`,
  see: (html: string) => `<div class="box see"><div class="box-t">What you should see</div>${html}</div>`,
  real: (html: string) => `<div class="box real"><div class="box-t">On a real FortiGate</div>${html}</div>`,
  shot: (src: string, caption: string) => `<figure><img src="${src}"/><figcaption>${caption}</figcaption></figure>`,
  step: (n: number, title: string, html: string) => `<div class="step"><div class="step-n">${n}</div><div class="step-b"><div class="step-t">${title}</div>${html}</div></div>`,
  ui: (path: string) => `<span class="ui">${path.split('>').map((x) => esc(x.trim())).join(' <span class="sep">›</span> ')}</span>`,
  k: (s: string) => `<code>${esc(s)}</code>`,
  cli: (lines: string) => `<pre class="cli">${esc(lines.trim())}</pre>`,
  list: (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`,
  ol: (items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`,
  table: (head: string[], rows: string[][]) => `<table><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  fields: (rows: [string, string][]) => `<table class="fields"><thead><tr><th>Field</th><th>What it means / what to enter</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><td class="f">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>`,
  trouble: (rows: [string, string, string][]) => `<table class="trouble"><thead><tr><th>Symptom</th><th>Likely cause</th><th>Fix</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  pagebreak: () => `<div class="pb"></div>`,
};

/** The FWallSim lab network, as a diagram (optionally highlighting part of it). */
export function labDiagram(highlight: 'none' | 'lan' | 'wan' | 'dmz' | 'path-out' | 'path-in' = 'none'): string {
  const hl = (k: string) => (highlight === k ? '#e8392f' : '#2f8f5b');
  const out = highlight === 'path-out';
  const inn = highlight === 'path-in';
  return `<svg class="diagram" viewBox="0 0 760 230" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Arial" font-size="12">
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#e8392f"/></marker></defs>
  <g stroke-width="3" fill="none">
    <line x1="150" y1="60" x2="300" y2="110" stroke="${hl('lan')}"/>
    <line x1="150" y1="160" x2="300" y2="120" stroke="${hl('lan')}"/>
    <line x1="460" y1="115" x2="570" y2="115" stroke="${hl('wan')}"/>
    <line x1="380" y1="145" x2="380" y2="185" stroke="${hl('dmz')}"/>
    <line x1="650" y1="115" x2="690" y2="115" stroke="#2f8f5b"/>
  </g>
  <g fill="#fff" stroke="#9aa5a7" stroke-width="1.5">
    <rect x="20" y="38" width="130" height="44" rx="6"/><rect x="20" y="138" width="130" height="44" rx="6"/>
    <rect x="300" y="85" width="160" height="60" rx="8" fill="#e3f3ea" stroke="#2f8f5b"/>
    <rect x="310" y="185" width="140" height="40" rx="6"/><rect x="570" y="95" width="80" height="40" rx="6"/>
    <ellipse cx="715" cy="115" rx="42" ry="30" fill="#f5f7f7"/>
  </g>
  <g fill="#263133" text-anchor="middle">
    <text x="85" y="57" font-weight="600">PC1-Admin</text><text x="85" y="72" fill="#6b7a7c">192.168.1.110</text>
    <text x="85" y="157" font-weight="600">PC2-Sales</text><text x="85" y="172" fill="#6b7a7c">192.168.1.111</text>
    <text x="380" y="110" font-weight="700">FortiGate</text><text x="380" y="126" fill="#6b7a7c">FWS60F</text>
    <text x="380" y="203" font-weight="600">Web-Server</text><text x="380" y="217" fill="#6b7a7c">10.10.10.10</text>
    <text x="610" y="113" font-weight="600">ISP</text><text x="610" y="127" fill="#6b7a7c">203.0.113.1</text>
    <text x="715" y="119" font-weight="600">Internet</text>
  </g>
  <g fill="#6b7a7c" font-size="11">
    <text x="205" y="70">internal 192.168.1.99</text><text x="470" y="105">wan1 203.0.113.10</text><text x="388" y="170">dmz 10.10.10.1</text>
    <text x="20" y="22" font-weight="600" fill="#263133">LAN (internal)</text><text x="560" y="22" font-weight="600" fill="#263133">WAN (Internet)</text>
  </g>
  ${out ? '<path d="M150,60 C220,70 260,100 300,108 M460,112 L690,112" stroke="#e8392f" stroke-width="2.5" fill="none" stroke-dasharray="6 4" marker-end="url(#ar)"/>' : ''}
  ${inn ? '<path d="M690,122 L460,122 M380,145 L380,183" stroke="#e8392f" stroke-width="2.5" fill="none" stroke-dasharray="6 4" marker-end="url(#ar)"/>' : ''}
</svg>`;
}

const CSS = `
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Lato, Arial, sans-serif; font-size: 10.4pt; line-height: 1.5; color: #1f2a2c; margin: 0; }
.cover { border-radius: 10px; background: linear-gradient(135deg, #1f2b2d, #2f4a46); color: #fff; padding: 22px 26px; margin-bottom: 14px; }
.cover .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 11pt; opacity: .9; }
.cover .logo { width: 26px; height: 26px; border-radius: 5px; background: #c8102e; display: grid; place-items: center; font-weight: 800; }
.cover .no { margin-top: 14px; font-size: 12pt; letter-spacing: 2px; text-transform: uppercase; color: #7fd3a1; font-weight: 700; }
.cover h1 { margin: 2px 0 4px; font-size: 24pt; line-height: 1.15; }
.cover .sub { font-size: 12pt; opacity: .85; }
.cover .meta { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.cover .meta span { background: rgba(255,255,255,.12); border-radius: 12px; padding: 2px 10px; font-size: 9.5pt; }
.goals { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
.goals > div { border: 1px solid #d4dbdb; border-radius: 8px; padding: 10px 14px; }
.goals h3 { margin: 0 0 4px; font-size: 10.5pt; color: #2f8f5b; text-transform: uppercase; letter-spacing: .5px; }
.goals ul { margin: 0; padding-left: 18px; }
h2 { font-size: 15pt; color: #1f2b2d; border-bottom: 2px solid #2f8f5b; padding-bottom: 3px; margin: 18px 0 10px; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12px 0 6px; break-after: avoid; }
p { margin: 6px 0; }
.box { border-radius: 8px; padding: 9px 13px; margin: 10px 0; break-inside: avoid; border-left: 5px solid; }
.box-t { font-weight: 700; font-size: 9pt; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 3px; }
.concept { background: #eef6f2; border-color: #2f8f5b; } .concept .box-t { color: #2f8f5b; }
.why { background: #eef3fa; border-color: #2d7fbf; } .why .box-t { color: #2d7fbf; }
.tip { background: #f3f1fb; border-color: #7a5cc6; } .tip .box-t { color: #7a5cc6; }
.warn { background: #fff6e8; border-color: #d68910; } .warn .box-t { color: #b4710a; }
.see { background: #effaf3; border-color: #3aa76d; } .see .box-t { color: #2f8f5b; }
.real { background: #f4f5f6; border-color: #6b7a7c; } .real .box-t { color: #4d5b5d; }
.step { display: grid; grid-template-columns: 32px 1fr; gap: 10px; margin: 12px 0; break-inside: avoid; }
.step-n { width: 28px; height: 28px; border-radius: 50%; background: #e8392f; color: #fff; font-weight: 700; display: grid; place-items: center; }
.step-t { font-weight: 700; font-size: 11pt; margin: 3px 0 4px; }
figure { margin: 8px 0 10px; break-inside: avoid; }
figure img { display: block; max-width: 100%; max-height: 215mm; width: auto; margin: 0 auto; object-fit: contain; border: 1px solid #c9d1d1; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
figcaption { font-size: 9pt; color: #5f6d6f; margin-top: 3px; font-style: italic; }
.ui { font-weight: 600; color: #1d5f8f; white-space: nowrap; } .ui .sep { color: #9aa5a7; font-weight: 400; }
code { font-family: Consolas, 'Cascadia Mono', monospace; font-size: 9.4pt; background: #eef1f1; padding: 1px 4px; border-radius: 3px; }
pre.cli { background: #1d2426; color: #cfe8d6; font-family: Consolas, monospace; font-size: 9pt; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.6pt; break-inside: avoid; }
th { background: #e7ecec; text-align: left; padding: 5px 8px; border: 1px solid #d4dbdb; }
td { padding: 5px 8px; border: 1px solid #d4dbdb; vertical-align: top; }
td.f { font-weight: 600; white-space: nowrap; width: 28%; }
table.trouble td:first-child { font-weight: 600; width: 28%; }
.diagram { width: 100%; height: auto; margin: 6px 0; }
.quiz { counter-reset: q; }
.quiz .q { break-inside: avoid; margin: 8px 0; }
.quiz .q b { display: block; }
.quiz .q ol { margin: 3px 0 0; list-style: upper-alpha; }
.answers { columns: 2; font-size: 9.4pt; }
.answers div { break-inside: avoid; margin-bottom: 6px; }
.terms td:first-child { font-weight: 600; width: 26%; }
.pb { break-after: page; }
.next { margin-top: 16px; padding: 10px 14px; border: 1px dashed #2f8f5b; border-radius: 8px; color: #2f4a46; }
`;

export function renderClass(d: ClassDoc, next?: { no: number; title: string }): string {
  const L = 'ABCDEFGH';
  return `<!doctype html><html><head><meta charset="utf-8"><title>FWallSim Class ${d.no}: ${esc(d.title)}</title><style>${CSS}</style></head><body>
<div class="cover"><div class="brand"><div class="logo">F</div>FWallSim · Firewall Course</div>
<div class="no">Class ${d.no}</div><h1>${esc(d.title)}</h1><div class="sub">${esc(d.subtitle)}</div>
<div class="meta"><span>${d.level}</span><span>~${d.minutes} minutes</span><span>FWallSim v1.0.0 (FortiOS 7.4 style)</span></div></div>
<div class="goals"><div><h3>You will learn</h3><ul>${d.goals.map((g) => `<li>${g}</li>`).join('')}</ul></div><div><h3>Before you start</h3>${d.before}</div></div>
${d.body}
${d.quiz.length ? `<section><h2>Quiz</h2><div class="quiz">${d.quiz.map((q, i) => `<div class="q"><b>${i + 1}. ${q.q}</b><ol>${q.options.map((o) => `<li>${o}</li>`).join('')}</ol></div>`).join('')}</div>
<h3>Answers</h3><div class="answers">${d.quiz.map((q, i) => `<div><b>${i + 1}. ${L[q.answer]}</b> ${q.why}</div>`).join('')}</div></section>` : ''}
${d.terms.length ? `<section><h2>Key terms</h2><table class="terms"><tbody>${d.terms.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></section>` : ''}
${next ? `<div class="next"><b>Next:</b> Class ${next.no}: ${esc(next.title)}</div>` : ''}
</body></html>`;
}
