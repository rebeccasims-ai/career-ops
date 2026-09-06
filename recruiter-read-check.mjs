#!/usr/bin/env node
/**
 * recruiter-read-check.mjs — the altitude gate.
 *
 * Would a recruiter who reads only the top third of page one see a person at
 * this level, in this function, at this scale? verify-cv-facts.mjs guards
 * fabrication and verify-ats.mjs guards parseability; neither asks that.
 * Zero-LLM, deterministic. Runs after the fact gate and before render.
 *
 * Usage:
 *   node recruiter-read-check.mjs <generated-cv.html> [--jd <jd.md|.txt>] [--title "JD title"] [--cv cv.md] [--config config/recruiter-read.yml] [--json]
 *   node recruiter-read-check.mjs --self-test
 *
 * Exit: 0 pass (warnings allowed) · 1 fail · 2 usage / unreadable input
 *
 * Config: config/recruiter-read.yml (user layer, gitignored) when present, otherwise the
 * shipped config/recruiter-read.example.yml. Not part of upstream career-ops.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// DEFAULT_CONFIG_PATH stays on the codebase ROOT: the user's config/recruiter-read.yml
// (gitignored) wins when it exists; the shipped .example.yml is the fallback so a fresh
// clone works out of the box. DEFAULT_CV_PATH is user-layer data (per the Data
// Contract) and must resolve from the data root.
const USER_CONFIG_PATH = join(ROOT, 'config', 'recruiter-read.yml');
export const EXAMPLE_CONFIG_PATH = join(ROOT, 'config', 'recruiter-read.example.yml');
export const DEFAULT_CONFIG_PATH = existsSync(USER_CONFIG_PATH) ? USER_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
export const DEFAULT_CV_PATH = join(getCareerOpsRoot(), 'cv.md');

// ── HTML → text ─────────────────────────────────────────────────────────────
const ENTITIES = { '&amp;': '&', '&#39;': "'", '&quot;': '"', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>' };

export function stripTags(fragment) {
  return String(fragment)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#39|quot|nbsp|lt|gt);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function removeNonContent(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function classBlock(fragment, cls) {
  const m = String(fragment).match(new RegExp(`<[^>]*class="${cls}"[^>]*>([\\s\\S]*?)<\\/`, 'i'));
  return m ? stripTags(m[1]) : '';
}

/**
 * Split a generated CV into the regions the checks read. Anchored on the
 * template's `.section-title` markers (the same anchor verify-ats.mjs uses),
 * so it works on every CV build-cv-html.mjs produces.
 */
export function extractRegions(html) {
  const body = removeNonContent(html);
  const parts = body.split(/<[^>]*class\s*=\s*"[^"]*\bsection-title\b[^"]*"[^>]*>/i);
  const header = parts[0] || '';
  const sections = {};
  for (const part of parts.slice(1)) {
    const close = part.indexOf('</');
    const title = stripTags(part.slice(0, close)).toLowerCase();
    sections[title] = part.slice(close);
  }
  const find = (needle) => {
    const key = Object.keys(sections).find((k) => k.includes(needle));
    return key ? sections[key] : '';
  };
  // The template renders no headline slot today; this covers a future one.
  const headlineMatch = header.match(/<[^>]*class\s*=\s*"[^"]*\b(?:headline|tagline)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
  const headline = headlineMatch ? stripTags(headlineMatch[1]) : '';
  const summary = stripTags(find('summary'));
  const jobs = find('experience').split(/<div class="job">/i).slice(1);
  const first = jobs[0] || '';
  const ulStart = first.search(/<ul\b/i);
  const beforeUl = ulStart >= 0 ? first.slice(0, ulStart) : first;
  // build-cv-html.mjs's template emits nothing between .job-header and <ul> today
  // (no intro paragraph slot), so after stripping job-header/role/location this is
  // routinely empty for generated CVs — checkScale's region still works off the
  // summary and first bullet.
  const introHtml = beforeUl
    .replace(/<div class="job-header">[\s\S]*?<\/div>/i, '')
    .replace(/<div class="job-(?:role|location)">[\s\S]*?<\/div>/gi, '');
  const bullets = [...first.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripTags(m[1]));
  return {
    headline,
    summary,
    firstRole: {
      company: classBlock(first, 'job-company'),
      role: classBlock(first, 'job-role'),
      dates: classBlock(first, 'job-period'),
      intro: stripTags(introHtml),
      bullets,
    },
    skills: stripTags(find('skills')),
  };
}

// ── Config ──────────────────────────────────────────────────────────────────
export function loadConfig(path = DEFAULT_CONFIG_PATH) {
  if (!existsSync(path)) throw new Error(`config not found: ${path}`);
  const cfg = yaml.load(readFileSync(path, 'utf-8')) || {};
  for (const key of ['functions', 'levels', 'jargon', 'thresholds']) {
    if (cfg[key] == null) throw new Error(`${path} is missing "${key}"`);
  }
  return cfg;
}

// ── cv.md → roles, levels ───────────────────────────────────────────────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function monthIndex(token, isEnd, now) {
  const t = String(token).trim().toLowerCase().replace(/\.$/, '');
  if (/^(present|current|now)$/.test(t)) return now.getFullYear() * 12 + now.getMonth() + 1;
  const my = t.match(/^([a-z]{3,9})\.?\s+(\d{4})$/);
  if (my && MONTHS[my[1].slice(0, 3)]) return Number(my[2]) * 12 + MONTHS[my[1].slice(0, 3)];
  const y = t.match(/^(\d{4})$/);
  if (y) return Number(y[1]) * 12 + (isEnd ? 12 : 1);
  return null;
}

/** "Aug 2018 – Mar 2020" → 19. Year-only ranges count Jan → Dec. Unparseable → null. */
export function parseDurationMonths(dates, now = new Date()) {
  const m = String(dates).match(/^(.+?)\s*[–—-]\s*(.+?)$/);
  if (!m) return null;
  const start = monthIndex(m[1], false, now);
  const end = monthIndex(m[2], true, now);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

/** cv.md experience headers: `### Title · Company · Location · Dates` (location optional). */
export function parseCvRoles(cvText) {
  const roles = [];
  for (const line of String(cvText).split('\n')) {
    const h = line.match(/^###\s+(.+)$/);
    if (!h) continue;
    const cells = h[1].split(' · ').map((s) => s.trim());
    if (cells.length < 2) continue;
    const dates = cells[cells.length - 1];
    roles.push({ title: cells[0], dates, months: parseDurationMonths(dates) });
  }
  return roles;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Whole-word, case-insensitive phrase test ("vp" does not match inside "svp"). */
export function containsPhrase(haystack, phrase) {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(phrase)}(?![a-z0-9])`, 'i').test(String(haystack));
}

/** Whole-word, case-insensitive, plural-tolerant term test: matches an optional trailing "s"/"es" ("MCP" also matches "MCPs"). */
export function containsTerm(haystack, term) {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(term)}(?:e?s)?(?![a-z0-9])`, 'i').test(String(haystack));
}

/** Highest level among every whole-word key that appears in the title (not the longest key — "VP, Head of Growth" is VP-level, not Head-of-level). */
export function levelOf(title, levels) {
  let best = null;
  for (const key of Object.keys(levels)) {
    if (containsPhrase(title, key) && (!best || levels[key] > best.level)) best = { key, level: levels[key] };
  }
  return best;
}

export function highestMultiYearLevel(cvText, levels, minMonths) {
  let best = null;
  for (const role of parseCvRoles(cvText)) {
    if (role.months == null || role.months < minMonths) continue;
    const lv = levelOf(role.title, levels);
    if (lv && (!best || lv.level > best.level)) best = { ...lv, title: role.title, months: role.months };
  }
  return best;
}

// ── Synthetic CV in the template's markup (tests + self-test) ───────────────
export function buildTestHtml({
  summary = '',
  role = 'Director of Marketing Operations',
  company = 'Acme',
  dates = 'Jan 2024 - Present',
  bullets = [],
  skills = 'AI & Automation: MCP, Kubernetes',
} = {}) {
  const lis = bullets.map((b) => `<li>${b}</li>`).join('\n');
  return `<html><body><div class="page">
<div class="header"><h1>Test Candidate</h1><div class="contact-row"><span>Remote</span></div></div>
<div class="section"><div class="section-title">Professional Summary</div><div class="summary-text">${summary}</div></div>
<div class="section"><div class="section-title">Work Experience</div>
<div class="job"><div class="job-header"><span class="job-company">${company}</span><span class="job-period">${dates}</span></div>
<div class="job-role">${role}</div><div class="job-location">Remote</div><ul>${lis}</ul></div></div>
<div class="section"><div class="section-title">Skills</div><div class="skills-row">${skills}</div></div>
</div></body></html>`;
}

// ── The four checks ─────────────────────────────────────────────────────────
const SCALE_PATTERNS = {
  budget: /\$\s?\d[\d,.]*\s?(?:[mkb]\b|million|billion)|\b\d[\d,.]*\s?(?:million|billion)\s+(?:in\s+)?(?:budget|spend|revenue|arr|ad spend|paid|media)\b/i,
  size: /\b\d[\d,]*\+?[\s-]*(?:person|people|employees|marketers|engineers|headcount)\b|\borg(?:anization)? of \d/i,
  team: /\bdirect reports?\b|\bteam of\b|\bmultiple reports\b|\bhiring\b|\bgrowing the team\b|\b(?:manage|managed|managing|lead|led|leading|built and led) (?:a |the )?team\b/i,
  reporting: /\breport(?:s|ing|ed)? (?:directly )?(?:to|into) (?:the )?(?:cmo|ceo|cro|coo|cfo|chief|vp\b|svp|president|founder)/i,
};

// Abbreviations whose trailing "." must not be read as a sentence end.
const ABBREVIATIONS = ['inc', 'ltd', 'llc', 'co', 'corp', 'u.s', 'sr', 'jr', 'dr', 'mr', 'ms', 'e.g', 'i.e', 'vs'];

export function firstSentence(text) {
  const str = String(text);
  const re = /[.!?](?=\s|$)/g;
  let m;
  let cut = -1;
  while ((m = re.exec(str))) {
    const before = str.slice(0, m.index);
    const lastWord = (before.match(/([a-z.]+)$/i) || [])[1] || '';
    if (ABBREVIATIONS.includes(lastWord.toLowerCase())) continue;
    cut = m.index + 1;
    break;
  }
  const result = cut >= 0 ? str.slice(0, cut) : str;
  return result.length < 40 ? str : result;
}

export function firstNonEmptyLine(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
}

export function checkFunction(regions, jdTitle, config) {
  const title = String(jdTitle || '').trim();
  if (!title) return { status: 'skipped', reason: 'no JD title (pass --jd or --title)', detected: [], present: [], missing: [] };
  const detected = Object.entries(config.functions)
    .filter(([, syns]) => syns.some((s) => containsPhrase(title, s)))
    .map(([name]) => name);
  if (!detected.length) return { status: 'skipped', reason: `no known function word in JD title "${title}"`, detected, present: [], missing: [] };
  const region = `${regions.headline} ${firstSentence(regions.summary)}`;
  const present = detected.filter((name) => config.functions[name].some((s) => containsPhrase(region, s)));
  const missing = detected.filter((name) => !present.includes(name));
  const status = present.length ? (missing.length ? 'warning' : 'pass') : 'fail';
  return { status, detected, present, missing };
}

export function checkScale(regions, config) {
  const region = [regions.summary, regions.firstRole.intro, regions.firstRole.bullets[0] || ''].join(' ');
  const categories = Object.entries(SCALE_PATTERNS).filter(([, re]) => re.test(region)).map(([name]) => name);
  const required = config.thresholds.min_scale_categories;
  return { status: categories.length >= required ? 'pass' : 'fail', categories, required };
}

/** Drop URLs and bare domains so a portfolio link like jane-doe.example.com never reads as jargon. */
export function scrubUrls(text) {
  return String(text)
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\.(?:app|com|io|dev|net|org|ai|co|me)\b/gi, ' ');
}

export function checkJargon(regions, jdText, config) {
  const jd = String(jdText || '');
  const inJd = (term) => containsTerm(jd, term);
  const scan = (text) => config.jargon.filter((term) => containsTerm(scrubUrls(text), term));
  const summaryHits = scan(regions.summary);
  const bulletHits = scan(regions.firstRole.bullets.join(' '));
  const lifted = [...new Set([...summaryHits, ...bulletHits])].filter(inJd);
  const summary = summaryHits.filter((t) => !inJd(t));
  const bullets = bulletHits.filter((t) => !inJd(t) && !summary.includes(t));
  const max = config.thresholds.max_summary_jargon;
  const status = summary.length > max ? 'fail' : (summary.length || bullets.length) ? 'warning' : 'pass';
  return { status, summary, bullets, lifted, max };
}

export function checkLevel(jdTitle, cvText, config) {
  const jd = levelOf(jdTitle || '', config.levels);
  if (!jd) return { status: 'skipped', reason: 'no level word in the JD title', jdTitle };
  const minMonths = config.thresholds.multi_year_months;
  const cand = highestMultiYearLevel(cvText, config.levels, minMonths);
  if (!cand) return { status: 'skipped', reason: `no role in cv.md held ${minMonths}+ months`, jdTitle };
  const distance = jd.level - cand.level;
  const status = distance >= config.thresholds.level_warning_distance ? 'warning' : 'pass';
  return { status, jdTitle, jdLevel: jd.level, jdKey: jd.key, candidateTitle: cand.title, candidateLevel: cand.level, candidateMonths: cand.months, distance };
}

export function analyze(html, { jdText = '', jdTitle = '', cvText = '', config } = {}) {
  if (!config) throw new Error('analyze() needs a config (see loadConfig)');
  const regions = extractRegions(html);
  if (regions.summary === '' && regions.firstRole.bullets.length === 0) {
    return {
      pass: false,
      fails: ['Parse: no Professional Summary or Work Experience section found — is this a generated CV? Section titles are matched in English (summary / experience / skills).'],
      warnings: [],
      info: [],
      checks: null,
      regions: { headline: regions.headline, summaryFirstSentence: firstSentence(regions.summary), firstRole: regions.firstRole.role },
    };
  }
  const title = jdTitle || firstNonEmptyLine(jdText);
  const checks = {
    function: checkFunction(regions, title, config),
    scale: checkScale(regions, config),
    jargon: checkJargon(regions, jdText, config),
    level: checkLevel(title, cvText, config),
  };
  const fails = [];
  const warnings = [];
  const info = [];
  const f = checks.function;
  if (f.status === 'fail') fails.push(`Function: the JD title names ${f.detected.join(', ')}; none of it appears in the headline or the summary's first sentence`);
  else if (f.status === 'warning') warnings.push(`Function: ${f.missing.join(', ')} named in the JD title but absent from the summary's first sentence`);
  else if (f.status === 'skipped') info.push(`Function check skipped: ${f.reason}`);
  const s = checks.scale;
  if (s.status === 'fail') fails.push(`Scale: ${s.categories.length} of ${s.required} required scale signals in the top block (${s.categories.join(', ') || 'none'}); add a budget figure, org or company size, a team line, or the reporting line`);
  const j = checks.jargon;
  if (j.status === 'fail') fails.push(`Jargon: ${j.summary.join(', ')} in the summary and not in the JD (max ${j.max} allowed)`);
  else if (j.status === 'warning') warnings.push(`Jargon not in the JD: summary [${j.summary.join(', ') || '-'}], first-role bullets [${j.bullets.join(', ') || '-'}]`);
  const l = checks.level;
  if (l.status === 'warning') warnings.push(`Level: "${l.jdTitle}" sits ${l.distance} levels above the highest title held ${config.thresholds.multi_year_months}+ months ("${l.candidateTitle}", ${l.candidateMonths} months)`);
  else if (l.status === 'skipped') info.push(`Level check skipped: ${l.reason}`);
  return {
    pass: fails.length === 0,
    fails,
    warnings,
    info,
    checks,
    regions: { headline: regions.headline, summaryFirstSentence: firstSentence(regions.summary), firstRole: regions.firstRole.role },
  };
}

// ── Self-test (synthetic documents only; no real names) ────────────────────
export function runSelfTest() {
  let passed = 0;
  let failed = 0;
  const check = (label, cond) => { if (cond) passed++; else { failed++; console.log(`  FAIL: ${label}`); } };
  const config = loadConfig();
  const cv = '### Director, Marketing Operations · Acme · Remote · Jan 2020 – Dec 2021\n### Senior Manager, Marketing · Beta · Remote · Jan 2015 – Dec 2019\n';
  const good = buildTestHtml({
    summary: 'Marketing operations leader with 12 years running a marketing org of 60 people and a $20M budget, reporting to the CMO.',
    bullets: ['Built the function from zero; multiple direct reports, and hiring.'],
  });
  const r1 = analyze(good, { jdTitle: 'Director of Marketing Operations', cvText: cv, config });
  check('on-function, scaled, plain CV passes', r1.pass && r1.warnings.length === 0);
  const r2 = analyze(good, { jdTitle: 'Head of Demand Generation', cvText: cv, config });
  check('off-function title fails', !r2.pass && r2.fails[0].startsWith('Function:'));
  const r3 = analyze(buildTestHtml({ summary: 'Marketing operations leader who loves systems.', bullets: ['Improved processes.'] }), { jdTitle: 'Director of Marketing Operations', cvText: cv, config });
  check('no scale signals fails', !r3.pass && r3.fails[0].startsWith('Scale:'));
  const r4 = analyze(buildTestHtml({ summary: 'Marketing operations leader who governs MCP connectors on Kubernetes with a $20M budget, reporting to the CMO.' }), { jdTitle: 'Director of Marketing Operations', cvText: cv, config });
  check('two unlifted jargon terms in the summary fails', !r4.pass && r4.fails[0].startsWith('Jargon:'));
  const r5 = analyze(good, { jdTitle: 'VP Marketing Operations', cvText: cv, config });
  check('two-level jump warns but passes', r5.pass && r5.warnings.some((w) => w.startsWith('Level:')));
  console.log(`recruiter-read-check self-test: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function usage() {
  return `Usage: node recruiter-read-check.mjs <generated-cv.html> [--jd <jd.md|.txt>] [--title "JD title"] [--cv cv.md] [--config config/recruiter-read.yml] [--json]
       node recruiter-read-check.mjs --self-test

Would a recruiter skimming the top third of page one see a person at this level,
in this function, at this scale? Fails on function mismatch, missing scale signals,
or jargon in the summary; warns on a two-level jump. Exit 0 pass, 1 fail, 2 usage
or unreadable input (no Professional Summary or Work Experience section found).`;
}

function printHuman(result, file) {
  console.log(`Recruiter-read check: ${file}`);
  console.log(`Top block: "${result.regions.summaryFirstSentence}"`);
  const list = (tag, items) => items.forEach((m) => console.log(`  [${tag}] ${m}`));
  if (result.fails.length) { console.log('\nFails:'); list('fail', result.fails); }
  if (result.warnings.length) { console.log('\nWarnings:'); list('warning', result.warnings); }
  if (result.info.length) { console.log('\nInfo:'); list('info', result.info); }
  console.log(`\nRecruiter-read check ${result.pass ? 'passed' : 'failed'}: ${file}`);
}

/** Parse argv and run. Returns the process exit code. */
export function runCli(args = process.argv.slice(2)) {
  if (args.includes('--self-test')) return runSelfTest();
  if (args.includes('--help') || args.includes('-h')) { console.log(usage()); return 0; }
  const opts = { jd: null, title: null, cv: DEFAULT_CV_PATH, config: DEFAULT_CONFIG_PATH, json: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const takesValue = { '--jd': 'jd', '--title': 'title', '--cv': 'cv', '--config': 'config' }[a];
    if (takesValue) {
      const v = args[i + 1];
      if (v == null || v.startsWith('--')) { console.error(`ERROR: ${a} requires a value\n${usage()}`); return 2; }
      opts[takesValue] = v;
      i++;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a.startsWith('--')) {
      console.error(`ERROR: unknown flag ${a}\n${usage()}`);
      return 2;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) { console.error(usage()); return 2; }
  const resolve = (p) => (isAbsolute(p) ? p : join(process.cwd(), p));
  const htmlPath = resolve(positional[0]);
  if (!existsSync(htmlPath)) { console.error(`ERROR: file not found: ${htmlPath}`); return 2; }
  let config;
  try { config = loadConfig(resolve(opts.config)); } catch (e) { console.error(`ERROR: ${e.message}`); return 2; }
  let jdText = '';
  if (opts.jd) {
    const jdPath = resolve(opts.jd);
    if (!existsSync(jdPath)) { console.error(`ERROR: JD file not found: ${jdPath}`); return 2; }
    jdText = readFileSync(jdPath, 'utf-8');
  }
  const cvPath = resolve(opts.cv);
  const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf-8') : '';
  const result = analyze(readFileSync(htmlPath, 'utf-8'), { jdText, jdTitle: opts.title || '', cvText, config });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result, positional[0]);
  if (result.checks === null) return 2;
  return result.pass ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  // exitCode, not exit(): lets buffered stdout drain (same reason as verify-ats.mjs).
  process.exitCode = runCli();
}
