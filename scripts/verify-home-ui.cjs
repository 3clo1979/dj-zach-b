// Deterministic component checks only: no browser, server, or real customer inquiries.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const serviceNames = ['DJ service', 'Uplighting', 'Digital photo booth', 'MC services', 'Custom playlists'];
const source = fs.readFileSync(path.join(root, 'app/home.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const text = node => Array.isArray(node) ? node.map(text).join('')
  : node && typeof node === 'object' ? text(node.props?.children)
  : node == null || typeof node === 'boolean' ? '' : String(node);
const elements = (node, predicate) => Array.isArray(node) ? node.flatMap(child => elements(child, predicate))
  : !node || typeof node !== 'object' || !node.props ? []
  : [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
const hasClass = (node, name) => (node.props?.className || '').split(/\s+/).includes(name);
const only = (matches, message) => {
  assert.equal(matches.length, 1, message);
  return matches[0];
};

function harness() {
  const slots = [], effects = [], calls = [];
  let cursor = 0, tree, started = false;
  const moduleObject = { exports: {} };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect(effect) { cursor++; if (!started) effects.push(effect); },
  };
  vm.runInNewContext(compiled, {
    module: moduleObject, exports: moduleObject.exports,
    require(name) {
      if (name === 'react') return hooks;
      if (name === './testimonials-section') return { __esModule: true, default: () => null };
      if (name === 'next/link') throw new Error('Homepage links must keep native anchor navigation.');
      return require(name);
    },
    FormData: class { constructor(values) { this.values = values; } get(key) { return this.values[key] ?? null; } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/events' && !options.method) return Response.json([]);
      if (url === '/api/inquiries' && options.method === 'POST') return Response.json({ reference: 'local-only' });
      throw new Error('Unexpected request: ' + url);
    },
    Date, Array, String, Error, Response,
  }, { filename: 'app/home.tsx' });
  const Home = moduleObject.exports.default;
  const render = () => { cursor = 0; tree = Home(); started = true; return tree; };
  const find = predicate => only(elements(tree, predicate), 'one matching element');
  const service = name => find(node => node.type === 'label' && hasClass(node, 'service-choice') && text(node).trim() === name);
  const checkbox = name => only(elements(service(name), node => node.type === 'input' && node.props.type === 'checkbox'), 'one checkbox for ' + name);
  const button = label => find(node => node.type === 'button' && text(node).includes(label));
  render();
  return {
    render, find, button, service, checkbox, calls,
    get tree() { return tree; },
    html() { return renderToStaticMarkup(tree); },
    toggle(name) { checkbox(name).props.onChange(); render(); },
    async submit(date = '2027-10-22') {
      await find(node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { date } });
      render();
    },
    async effects() { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

(async () => {
  const home = harness();
  await home.effects();
  assert.deepEqual(home.calls.map(call => call.url), ['/api/events'], 'only mocked public events load');
  assert.equal(elements(home.tree, node => hasClass(node, 'service-choice')).length, 5, 'all five service options remain present');
  for (const name of serviceNames) assert.equal(home.checkbox(name).props.checked, name === 'DJ service', name + ' initial selection');

  const serviceIcons = serviceNames.map(name => {
    const label = home.service(name);
    const body = only(elements(label, node => node.type === 'span' && elements(node, child => child.type === 'b' && text(child) === name).length > 0), 'one service label body');
    const markup = renderToStaticMarkup(body);
    const svg = markup.match(/<svg\b[^>]*>.*?<\/svg>/g) || [];
    assert.equal(svg.length, 1, name + ': exactly one semantic icon');
    assert.match(svg[0], /aria-hidden="true"/, name + ': icon is decorative beside readable label');
    assert.doesNotMatch(svg[0], /tabindex="0"|role="button"/i, name + ': icon does not create a separate control');
    return svg[0].replace(/width="[^"]*"|height="[^"]*"/g, '');
  });
  assert.equal(new Set(serviceIcons).size, 5, 'each service has its own distinct icon rather than a positional fallback');

  for (const name of serviceNames) {
    const initial = home.checkbox(name).props.checked;
    home.toggle(name);
    assert.equal(home.checkbox(name).props.checked, !initial, name + ': toggles on/off');
    home.toggle(name);
    assert.equal(home.checkbox(name).props.checked, initial, name + ': repeated toggle restores state');
  }

  for (const [name, className] of [['Uplighting', 'lighting'], ['Digital photo booth', 'booth']]) {
    const extraButton = () => only(elements(home.find(node => node.type === 'article' && hasClass(node, className)), node => node.type === 'button'), 'one extras toggle');
    extraButton().props.onClick(); home.render();
    assert.equal(home.checkbox(name).props.checked, true, name + ': extras selection synchronizes with form');
    assert.equal(extraButton().props['aria-pressed'], true, name + ': extras reflects selected state');
    home.toggle(name);
    assert.equal(extraButton().props['aria-pressed'], false, name + ': form selection synchronizes back to extras');
  }

  const badges = elements(home.tree, node => hasClass(node, 'credential-badge'));
  assert.equal(badges.length, 2, 'two dedicated prominent credential badges');
  const badgeText = badges.map(node => text(node).replace(/\s+/g, '').toLowerCase());
  assert(badgeText.some(value => value.includes('18') && value.includes('yearsofexperience')), '18 years of experience badge');
  assert(badgeText.some(value => value.includes('300+') && value.includes('weddingscelebrated')), '300+ weddings badge');
  for (const badge of badges) {
    assert.notEqual(badge.type, 'button', 'credential is informational, not a fake button');
    assert(!elements(badge, node => node.type === 'a' || node.type === 'button').length, 'badge has no confusing interactive affordance');
  }

  const tracks = elements(home.find(node => hasClass(node, 'night-tracks')), node => node.type === 'article');
  assert.equal(tracks.length, 3, 'all three experience rows remain present');
  for (const track of tracks) {
    const markup = renderToStaticMarkup(track);
    assert.equal((markup.match(/<svg\b/g) || []).length, 1, 'each experience row has one icon, not duplicate decorations');
    assert.doesNotMatch(markup, /<span(?:\s[^>]*)?>0[123]<\/span>/, 'experience row numbers are replaced, not repeated');
    assert.match(markup, /^<article[^>]*>\s*(?:<span[^>]*>)?<svg\b/, 'experience icon leads the row');
  }

  const footer = home.find(node => node.type === 'footer');
  const footerHtml = renderToStaticMarkup(footer);
  assert.doesNotMatch(footerHtml, /[←-⇿➔➜➝➞➟➠➡⤴⤵]|lucide-arrow/, 'footer contains no block arrows, arrow glyphs, or arrow SVGs');
  const footerLinks = elements(footer, node => node.type === 'a');
  for (const href of ['#inquire', 'tel:4403961363', '/testimonials', 'https://www.facebook.com/share/1BzYUSnvR5/?mibextid=wwXIfr', '/studio', '#', 'https://camytagroup.com']) {
    assert(footerLinks.some(link => link.props.href === href), 'preserved footer destination: ' + href);
  }
  const shareLink = only(footerLinks.filter(link => link.props.href === '/testimonials'), 'one testimonial footer link');
  assert(!shareLink.props.onClick, 'testimonial footer keeps native document navigation');
  assert.match(text(shareLink), /Share your experience/, 'testimonial link retains readable action');
  for (const svg of footerHtml.match(/<svg\b[^>]*>/g) || []) assert.match(svg, /aria-hidden="true"/, 'footer icons are decorative');
  for (const link of footerLinks.filter(link => link.props.target === '_blank')) assert.match(link.props.rel, /noreferrer/, 'external footer links retain safe rel');

  const menuButton = () => home.find(node => node.type === 'button' && hasClass(node, 'menu-toggle'));
  assert.equal(menuButton().props['aria-expanded'], false);
  menuButton().props.onClick(); home.render();
  assert.equal(menuButton().props['aria-expanded'], true, 'navigation opens');
  menuButton().props.onClick(); home.render();
  assert.equal(menuButton().props['aria-expanded'], false, 'navigation closes without changing anchors');
  menuButton().props.onClick(); home.render();
  const nav = home.find(node => node.type === 'nav');
  const navLinks = elements(nav, node => node.type === 'a');
  assert.deepEqual(Array.from(navLinks, link => link.props.href), ['#experience', '#extras', '#zach', '#live']);
  navLinks[1].props.onClick(); home.render();
  assert.equal(menuButton().props['aria-expanded'], false, 'section navigation dismisses mobile menu');

  home.toggle('DJ service');
  await home.submit('');
  assert.match(home.html(), /Choose your event date\./, 'missing date validation stays on first step');
  await home.submit();
  assert.match(home.html(), /Choose at least one service\./, 'empty service selection validation preserved');
  assert.equal(elements(home.tree, node => hasClass(node, 'service-choice')).length, 5, 'invalid submission does not advance');
  for (const name of serviceNames) home.toggle(name);
  const venue = home.find(node => node.type === 'input' && node.props.placeholder?.startsWith('Venue name'));
  venue.props.onChange({ target: { value: 'Local test venue' } }); home.render();
  await home.submit();
  const summary = home.find(node => hasClass(node, 'request-summary'));
  for (const name of serviceNames) assert(text(summary).includes(name), name + ': preserved in next-step summary');
  assert.match(text(summary), /Oct 22, 2027/, 'selected date appears in summary');
  home.button('Back to your night').props.onClick(); home.render();
  for (const name of serviceNames) assert.equal(home.checkbox(name).props.checked, true, name + ': retained after Back');
  assert.equal(home.find(node => node.type === 'input' && node.props.name === 'date').props.defaultValue, '2027-10-22', 'date retained after Back');
  assert.equal(home.find(node => node.type === 'input' && node.props.placeholder?.startsWith('Venue name')).props.value, 'Local test venue', 'venue retained after Back');
  await home.submit();
  await home.submit();
  const post = only(home.calls.filter(call => call.options.method === 'POST'), 'one mocked inquiry POST');
  assert.deepEqual(JSON.parse(post.options.body).services, serviceNames, 'icons do not alter exact submitted service values');
  assert.match(home.html(), /Your inquiry is saved for Zach to review/, 'mocked inquiry success still works');
  assert.equal(elements(home.tree, node => node.type === 'form').length, 0, 'success replaces inquiry form');
  console.log('Homepage UI checks passed: five distinct decorative service icons, repeated selection, extras/form synchronization, two credential badges, semantic footer/native links, menu navigation, validation, next/back state, exact inquiry service payload, and mocked success. Browser layout not covered.');
})().catch(error => { console.error(error); process.exitCode = 1; });
