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
