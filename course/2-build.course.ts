// Builds the Class PDFs from the built-in training labs (src/labs/labs.ts) plus the
// screenshots captured by 1-capture.course.ts. One class per lab, in lab order.
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LABS, type Lab } from '../src/labs/labs';
import { h, labDiagram, renderClass, type ClassDoc } from './template';

const ROOT = path.resolve('course');
const OUT = path.join(ROOT, 'out');
const PDF = path.join(ROOT, 'pdf');

// Screenshot folders that illustrate each lab.
const SHOTS: Record<string, string[]> = {
  'l1-basics': ['c01', 'c07'],
  'l2-first-policy': ['c03'],
  'l3-logging': ['c05'],
  'l4-objects': ['c04'],
  'l5-vip': ['c06'],
  'l7-renumber': ['c02'],
  'l13-dynamic': ['c08'],
};

const pretty = (n: string) => n.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bCli\b/g, 'CLI').replace(/\bDnat\b/g, 'DNAT').replace(/\bDhcp\b/g, 'DHCP').replace(/\bApipa\b/g, 'APIPA').replace(/\bWan1\b/g, 'wan1').replace(/\bSsl Vpn\b/g, 'SSL-VPN').replace(/\bSd Wan\b/g, 'SD-WAN').replace(/\bVpn\b/g, 'VPN').replace(/\bIpsec\b/g, 'IPsec').replace(/\bIps\b/g, 'IPs').replace(/\bLdap\b/g, 'LDAP');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function gallery(lab: Lab): string {
  const dirs = [...(SHOTS[lab.id] ?? []), lab.id];
  const figs = dirs.flatMap((d) => {
    const dir = path.join(ROOT, 'img', d);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => h.shot(`../img/${d}/${f}`, pretty(f.replace(/\.png$/, ''))));
  });
  return figs.length ? h.section('Screenshots', h.p('Numbered red markers show where to click or what to look at.') + figs.join('')) : '';
}

function toClass(lab: Lab, no: number): ClassDoc {
  const challenge = lab.level === 'Challenge';
  const body = [
    h.section('The lab network', labDiagram('none')),
    h.section('The goal', h.concept(`<p>${esc(lab.intro)}</p>`)),
    h.section(
      'How to start',
      h.ol([`Open FWallSim and log in.`, `Click <b>Labs</b> in the header.`, `Find <b>${esc(lab.title)}</b> and click <b>Start</b>.`, `The Lab Guide panel opens. Each task below gets a green tick as soon as it works.`]),
    ),
    h.section('Tasks', lab.tasks.map((t, i) => h.step(i + 1, esc(t.title), h.p(esc(t.how)))).join('')),
    lab.hints?.length ? h.section('Hints', h.ol(lab.hints.map(esc))) : '',
    lab.solution?.length ? h.pagebreak() + h.section('Solution', h.ol(lab.solution.map(esc))) : '',
    gallery(lab),
  ].join('');
  return {
    no,
    slug: lab.id,
    title: lab.title,
    subtitle: lab.topic,
    minutes: lab.minutes,
    level: challenge ? 'Advanced' : lab.level,
    goals: lab.topic.split(',').map((x) => esc(x.trim())),
    before: no === 1 ? '<p>Start FWallSim with <code>npm run dev</code> and open http://localhost:5173.</p>' : `<p>Finish Class ${no - 1} first.</p>`,
    body,
    quiz: [],
    terms: [],
  };
}

// Class 0: the course plan, an ordered list of every class.
function plan(docs: ClassDoc[]): ClassDoc {
  const part = (name: string, from: number, to: number) =>
    h.section(name, h.table(['Class', 'Title', 'Topics', 'Time', 'PDF'], docs.filter((d) => d.no >= from && d.no <= to).map((d) => [`<b>${d.no}</b>`, esc(d.title), esc(d.subtitle), `~${d.minutes} min`, `<code>FWallSim-Class-${String(d.no).padStart(2, '0')}-${d.slug}.pdf</code>`])));
  const total = docs.reduce((s, d) => s + d.minutes, 0);
  return {
    no: 0,
    slug: 'course-plan',
    title: 'Course plan',
    subtitle: `${docs.length} classes, about ${Math.round(total / 60)} hours, in the order to take them`,
    minutes: total,
    level: 'Beginner',
    goals: ['Which class to take next', 'What each class covers', 'Which PDF file belongs to each class'],
    before: '<p>Start with Class 1 and go in order. Each class builds on the one before it.</p>',
    body: [
      h.section('How every class works', h.ol(['Read the goal and look at the lab network diagram.', 'In FWallSim click <b>Labs</b>, find the class title and click <b>Start</b>.', 'Do the numbered tasks. The Lab Guide on the right ticks each task green the moment it works.', 'Use the screenshots when you are not sure where to click.', 'In the troubleshooting classes, try the hints first and look at the solution last.'])),
      part('Part 1: Beginner, the basics', 1, 5),
      part('Part 2: Intermediate, running the firewall', 6, 9),
      part('Part 3: Advanced, VPN and routing', 10, 13),
      part('Part 4: Troubleshooting challenges', 14, docs.length),
    ].join(''),
    quiz: [],
    terms: [],
  };
}

test('build class PDFs', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PDF, { recursive: true });
  const classes = LABS.map((l, i) => toClass(l, i + 1));
  const docs = [plan(classes), ...classes];
  for (const [i, d] of docs.entries()) {
    const nn = String(d.no).padStart(2, '0');
    const html = path.join(OUT, `Class${nn}.html`);
    const next = docs[i + 1];
    fs.writeFileSync(html, renderClass(d, next && { no: next.no, title: next.title }));
    await page.goto(pathToFileURL(html).href);
    await page.waitForLoadState('load');
    await page.pdf({
      path: path.join(PDF, `FWallSim-Class-${nn}-${d.slug}.pdf`),
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;color:#888;width:100%;text-align:center">FWallSim v1.0.0 · Class ${d.no}: ${esc(d.title)} · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  }
});
