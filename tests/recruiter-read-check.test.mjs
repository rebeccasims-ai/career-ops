// tests/recruiter-read-check.test.mjs — altitude gate: regions, cv.md parsing, checks, CLI
import { pass, fail } from './helpers.mjs';
import {
  extractRegions, buildTestHtml, parseDurationMonths, parseCvRoles, levelOf, highestMultiYearLevel, loadConfig,
} from '../recruiter-read-check.mjs';

console.log('\nrecruiter-read-check.mjs — regions and cv.md parsing');

const html = buildTestHtml({
  summary: 'Marketing operations leader. Second sentence.',
  role: 'Director of Marketing Operations',
  company: 'Acme',
  dates: 'Jan 2024 - Present',
  bullets: ['Built the function, reporting to the CMO.', 'Second bullet with MCP.'],
  skills: 'AI: MCP, Netlify',
});
const r = extractRegions(html);
if (r.summary === 'Marketing operations leader. Second sentence.') pass('extractRegions reads the summary'); else fail(`summary was ${JSON.stringify(r.summary)}`);
if (r.firstRole.role === 'Director of Marketing Operations' && r.firstRole.company === 'Acme') pass('extractRegions reads the first role and company'); else fail(`firstRole was ${JSON.stringify(r.firstRole)}`);
if (r.firstRole.bullets.length === 2 && r.firstRole.bullets[0] === 'Built the function, reporting to the CMO.') pass('extractRegions reads first-role bullets'); else fail(`bullets were ${JSON.stringify(r.firstRole.bullets)}`);
if (r.skills.includes('Netlify')) pass('extractRegions reads the skills block'); else fail(`skills was ${JSON.stringify(r.skills)}`);
if (r.headline === '') pass('extractRegions yields an empty headline for the template (no headline slot)'); else fail(`headline was ${JSON.stringify(r.headline)}`);

const levels = { manager: 1, 'senior manager': 2, director: 3, 'head of': 3, 'senior director': 4, vp: 5, 'vice president': 5, svp: 6 };
if (parseDurationMonths('Aug 2018 – Mar 2020') === 19) pass('parseDurationMonths: Aug 2018 – Mar 2020 = 19'); else fail(`got ${parseDurationMonths('Aug 2018 – Mar 2020')}`);
if (parseDurationMonths('2016 – 2017') === 23) pass('parseDurationMonths: year-only 2016 – 2017 = 23'); else fail(`got ${parseDurationMonths('2016 – 2017')}`);
if (parseDurationMonths('Jan 2026 – Present', new Date(2026, 8, 1)) === 8) pass('parseDurationMonths: Present resolves to now'); else fail(`got ${parseDurationMonths('Jan 2026 – Present', new Date(2026, 8, 1))}`);
if (parseDurationMonths('garbage') === null) pass('parseDurationMonths: unparseable → null'); else fail('expected null');

const cv = [
  '# Test', '', '### Head of Marketing Operations · Acme · Austin, TX · Jan 2026 – Present',
  '### Senior Manager, Lifecycle · Beta · Austin, TX · Mar 2020 – Jan 2026',
  '### Director, Growth Marketing · Gamma · Austin, TX · Aug 2018 – Mar 2020',
  '### Head of Marketing · Delta · Houston, TX · Jul 2017 – Aug 2018',
].join('\n');
const roles = parseCvRoles(cv);
if (roles.length === 4 && roles[2].title === 'Director, Growth Marketing' && roles[2].months === 19) pass('parseCvRoles reads title and months from ### headers'); else fail(`roles were ${JSON.stringify(roles)}`);
if (levelOf('VP Marketing Strategy and Operations', levels)?.level === 5) pass('levelOf: VP → 5'); else fail('VP should be 5');
if (levelOf('Senior Director, Global Revenue Marketing', levels)?.level === 4) pass('levelOf: Senior Director beats Director'); else fail('Senior Director should be 4');
if (levelOf('SVP Marketing', levels)?.level === 6) pass('levelOf: SVP does not match vp inside the word'); else fail('SVP should be 6');
if (levelOf('Head of Demand Generation', levels)?.level === 3) pass('levelOf: Head of → 3'); else fail('Head of should be 3');
if (levelOf('Marketing Wizard', levels) === null) pass('levelOf: no level word → null'); else fail('expected null');
const best = highestMultiYearLevel(cv, levels, 18);
if (best && best.level === 3 && best.title === 'Director, Growth Marketing') pass('highestMultiYearLevel: 19-month Director outranks 70-month Senior Manager; 8-month Head of excluded'); else fail(`best was ${JSON.stringify(best)}`);

const cfg = loadConfig();
if (cfg.functions['marketing operations'] && cfg.levels.vp === 5 && Array.isArray(cfg.jargon) && cfg.thresholds.min_scale_categories === 2) pass('loadConfig reads config/recruiter-read.yml'); else fail(`config was ${JSON.stringify(cfg)}`);
import { analyze, checkFunction, checkScale, checkJargon, checkLevel, firstSentence, firstNonEmptyLine } from '../recruiter-read-check.mjs';

console.log('\nrecruiter-read-check.mjs — the four checks');

const CFG = loadConfig();
const CV = [
  '### Head of Marketing Operations · Acme · Austin, TX · Jan 2026 – Present',
  '### Senior Manager, Lifecycle · Beta · Austin, TX · Mar 2020 – Jan 2026',
  '### Director, Growth Marketing · Gamma · Austin, TX · Aug 2018 – Mar 2020',
].join('\n');
const GOOD_SUMMARY = 'Marketing operations leader with 12 years running a marketing org of 60 people and a $20M budget, reporting to the CMO. Second sentence.';
const good = buildTestHtml({ summary: GOOD_SUMMARY, role: 'Director of Marketing Operations', bullets: ['Built the function from zero; multiple direct reports, and hiring.', 'Second bullet.'] });

if (firstSentence(GOOD_SUMMARY) === 'Marketing operations leader with 12 years running a marketing org of 60 people and a $20M budget, reporting to the CMO.') pass('firstSentence stops at the first period'); else fail(`firstSentence gave ${JSON.stringify(firstSentence(GOOD_SUMMARY))}`);
if (firstNonEmptyLine('\n\n# **Director of Marketing Operations**\nbody') === 'Director of Marketing Operations') pass('firstNonEmptyLine strips heading marks and bold'); else fail('firstNonEmptyLine');

const okAll = analyze(good, { jdTitle: 'Director of Marketing Operations', cvText: CV, config: CFG });
if (okAll.pass && okAll.fails.length === 0) pass('analyze: on-function, scaled, plain-language CV passes'); else fail(`expected pass, got ${JSON.stringify(okAll.fails)}`);
if (okAll.checks.scale.categories.length >= 3) pass(`analyze: scale sees ${okAll.checks.scale.categories.join(', ')}`); else fail(`scale categories ${JSON.stringify(okAll.checks.scale.categories)}`);

const fn = checkFunction(extractRegions(good), 'Head of Demand Generation', CFG);
if (fn.status === 'fail' && fn.detected.includes('demand generation')) pass('checkFunction: demand-gen title vs ops summary fails'); else fail(`checkFunction gave ${JSON.stringify(fn)}`);
const fnWarn = checkFunction(extractRegions(good), 'VP Marketing Strategy and Operations', CFG);
if (fnWarn.status === 'warning' && fnWarn.present.includes('marketing operations') && fnWarn.missing.includes('strategy')) pass('checkFunction: one function present, one missing → warning'); else fail(`checkFunction gave ${JSON.stringify(fnWarn)}`);
if (checkFunction(extractRegions(good), '', CFG).status === 'skipped') pass('checkFunction: no title → skipped'); else fail('checkFunction should skip without a title');

const flat = buildTestHtml({ summary: 'Marketing operations leader who loves systems. More words.', bullets: ['Improved processes.'] });
const sc = checkScale(extractRegions(flat), CFG);
if (sc.status === 'fail' && sc.categories.length === 0) pass('checkScale: no scale signals → fail'); else fail(`checkScale gave ${JSON.stringify(sc)}`);
const flatRes = analyze(flat, { jdTitle: 'Director of Marketing Operations', cvText: CV, config: CFG });
if (!flatRes.pass && flatRes.fails.some((f) => f.startsWith('Scale:'))) pass('analyze: scale fail surfaces as a fail line'); else fail(`fails were ${JSON.stringify(flatRes.fails)}`);

const jargony = buildTestHtml({ summary: 'Marketing operations leader who governs MCP connectors on Netlify with a $20M budget, reporting to the CMO.', bullets: ['Shipped apps on Claude.'] });
const jg = checkJargon(extractRegions(jargony), '', CFG);
if (jg.status === 'fail' && jg.summary.includes('MCP') && jg.summary.includes('Netlify') && jg.bullets.includes('Claude')) pass('checkJargon: two unlifted terms in the summary → fail; bullet term listed'); else fail(`checkJargon gave ${JSON.stringify(jg)}`);
const lifted = checkJargon(extractRegions(jargony), 'We run MCP servers on Netlify and Claude.', CFG);
if (lifted.status === 'pass' && lifted.lifted.length === 3) pass('checkJargon: terms the JD uses are lifted'); else fail(`lifted gave ${JSON.stringify(lifted)}`);
const skillsOnly = buildTestHtml({ summary: GOOD_SUMMARY, bullets: ['Plain bullet.'], skills: 'MCP, Netlify, Claude, n8n' });
if (checkJargon(extractRegions(skillsOnly), '', CFG).status === 'pass') pass('checkJargon: the Skills block is exempt'); else fail('skills block should be exempt');

const urlOnly = buildTestHtml({ summary: 'Marketing operations leader with a $20M budget, reporting to the CMO. Portfolio: becca-bot.netlify.app.', bullets: ['See https://example.netlify.app/notion for details.'] });
const urlRes = checkJargon(extractRegions(urlOnly), '', CFG);
if (urlRes.status === 'pass' && urlRes.summary.length === 0 && urlRes.bullets.length === 0) pass('checkJargon: terms inside URLs and domains are not jargon'); else fail(`checkJargon URL scrub gave ${JSON.stringify(urlRes)}`);

const lv = checkLevel('VP Marketing Operations', CV, CFG);
if (lv.status === 'warning' && lv.distance === 2 && lv.candidateTitle === 'Director, Growth Marketing') pass('checkLevel: VP vs 19-month Director → distance 2 → warning'); else fail(`checkLevel gave ${JSON.stringify(lv)}`);
if (checkLevel('Senior Director, Marketing Operations', CV, CFG).status === 'pass') pass('checkLevel: Senior Director → distance 1 → pass'); else fail('Sr Director should pass');
if (checkLevel('Marketing Wizard', CV, CFG).status === 'skipped') pass('checkLevel: no level word → skipped'); else fail('should skip');
const vpRes = analyze(good, { jdTitle: 'VP Marketing Operations', cvText: CV, config: CFG });
if (vpRes.pass && vpRes.warnings.some((w) => w.startsWith('Level:'))) pass('analyze: level distance is a warning, not a fail'); else fail(`vpRes ${JSON.stringify({ pass: vpRes.pass, warnings: vpRes.warnings })}`);
const titled = analyze(good, { jdText: '# Director of Marketing Operations\n\nAbout the role…', cvText: CV, config: CFG });
if (titled.checks.function.status === 'pass') pass('analyze: JD title falls back to the first non-empty JD line'); else fail(`function ${JSON.stringify(titled.checks.function)}`);

import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ROOT, rmSync } from './helpers.mjs';

console.log('\nrecruiter-read-check.mjs — CLI');

const dir = mkdtempSync(join(tmpdir(), 'rrc-'));
const goodPath = join(dir, 'good.html');
writeFileSync(goodPath, good);
const badPath = join(dir, 'bad.html');
writeFileSync(badPath, flat);
const jdPath = join(dir, 'jd.md');
writeFileSync(jdPath, '# Director of Marketing Operations\n\nWe need someone to own the stack.\n');
const cvPath = join(dir, 'cv.md');
writeFileSync(cvPath, CV);
const script = join(ROOT, 'recruiter-read-check.mjs');
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf-8' });

try {
  const ok = cli(goodPath, '--jd', jdPath, '--cv', cvPath);
  if (ok.status === 0 && ok.stdout.includes('passed')) pass('CLI exits 0 on a passing CV'); else fail(`CLI pass: status ${ok.status}\n${ok.stdout}${ok.stderr}`);
  const bad = cli(badPath, '--jd', jdPath, '--cv', cvPath);
  if (bad.status === 1 && bad.stdout.includes('[fail] Scale:')) pass('CLI exits 1 and prints the fail line on a flat CV'); else fail(`CLI fail: status ${bad.status}\n${bad.stdout}${bad.stderr}`);
  const js = cli(goodPath, '--jd', jdPath, '--cv', cvPath, '--json');
  let parsed = null;
  try { parsed = JSON.parse(js.stdout); } catch { /* handled below */ }
  if (parsed && parsed.pass === true && parsed.checks.function.status === 'pass') pass('CLI --json emits the analyze() result'); else fail(`CLI json: ${js.stdout}${js.stderr}`);
  const usage = cli();
  if (usage.status === 2 && usage.stderr.includes('Usage')) pass('CLI exits 2 with usage when no file is given'); else fail(`usage: status ${usage.status}`);
  const missing = cli(join(dir, 'nope.html'));
  if (missing.status === 2) pass('CLI exits 2 on a missing file'); else fail(`missing: status ${missing.status}`);
  const dangling = cli(goodPath, '--jd');
  if (dangling.status === 2) pass('CLI exits 2 when --jd has no value'); else fail(`dangling: status ${dangling.status}`);
  const self = cli('--self-test');
  if (self.status === 0 && /self-test: \d+ passed, 0 failed/.test(self.stdout)) pass('CLI --self-test passes'); else fail(`self-test: status ${self.status}\n${self.stdout}${self.stderr}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nrecruiter-read-check.mjs — DEFAULT_CV_PATH resolves from the data root');

const dir2 = mkdtempSync(join(tmpdir(), 'rrc-root-'));
try {
  writeFileSync(join(dir2, 'cv.md'), '### Director, Test · Acme · Remote · Jan 2020 – Dec 2022\n');
  const goodPath2 = join(dir2, 'good.html');
  writeFileSync(goodPath2, good);
  const rootRun = spawnSync(process.execPath, [script, goodPath2, '--title', 'VP Marketing Operations', '--json'], {
    env: { ...process.env, CAREER_OPS_ROOT: dir2 },
    encoding: 'utf-8',
  });
  let rootParsed = null;
  try { rootParsed = JSON.parse(rootRun.stdout); } catch { /* handled below */ }
  if (rootParsed && rootParsed.checks.level.candidateTitle === 'Director, Test') pass('CLI without --cv resolves cv.md from CAREER_OPS_ROOT, not the codebase root'); else fail(`root run: status ${rootRun.status}\n${rootRun.stdout}${rootRun.stderr}`);
} finally {
  rmSync(dir2, { recursive: true, force: true });
}
