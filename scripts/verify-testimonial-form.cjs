// Deterministic component-level checks, not browser/layout or live-service tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const consentVersion = /TESTIMONIAL_CONSENT_VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(root, 'app/testimonials-contract.ts'), 'utf8'))[1];

function harness(file, fetchImpl = () => { throw new Error('Unexpected network request'); }) {
  let cursor = 0;
  let tree;
  const slots = [];
  const pendingEffects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        const entry = { dependencies, cleanup: previous?.cleanup };
        slots[index] = entry;
        pendingEffects.push(() => {
          entry.cleanup?.();
          entry.cleanup = effect();
        });
      }
    },
  };
  function load(filename) {
    const module = { exports: {} };
    const source = fs.readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console, crypto, AbortController,
      fetch: fetchImpl,
      require(name) {
        if (name === 'react') return hooks;
        // Native document navigation avoids the deployed Vinext Link/RSC router failure.
        if (name === 'next/link') throw new Error('Testimonial navigation must use native anchors, not a mocked framework router.');
        if (name.includes('testimonials-contract')) return load(path.join(root, 'app/testimonials-contract.ts'));
        return require(name);
      },
    }, { filename });
    return module.exports;
  }
  const Component = load(path.join(root, file)).default;
  function render() {
    cursor = 0;
    tree = Component();
    return tree;
  }
  function visit(predicate, node) {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = visit(predicate, child);
        if (match) return match;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    if (predicate(node)) return node;
    return visit(predicate, node.props?.children);
  }
  function find(predicate) { return visit(predicate, tree); }
  render();
  return {
    render, find,
    html() { return renderToStaticMarkup(tree); },
    change(id, value) {
      const element = find(node => node.props?.id === id);
      assert(element, `Missing field ${id}`);
      element.props.onChange({ target: { value, checked: value } });
      render();
    },
    submit() {
      return find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    },
    async effects() {
      pendingEffects.splice(0).forEach(effect => effect());
      // Flush the fetch/JSON promise chain without real timers or services.
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
  };
}

function populate(form) {
  form.change('testimonial-name', 'A. Guest');
  form.change('testimonial-email', 'guest@example.com');
  form.change('testimonial-message', 'An honest experience about an event.');
  form.change('testimonial-consent', true);
}

(async () => {
  for (const file of ['app/home.tsx', 'app/testimonials-section.tsx', 'app/testimonials/testimonial-form.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!source.includes('next/link'), file + ': all testimonial entry/return links avoid the incompatible client router');
  }
  const footerSource = fs.readFileSync(path.join(root, 'app/home.tsx'), 'utf8').split('<footer')[1];
  const footerShareLink = footerSource?.match(/<a\b[^>]*href="\/testimonials"[^>]*>([\s\S]*?)<\/a>/)?.[0];
  assert(footerShareLink, 'footer uses a native testimonial anchor');
  assert.match(footerShareLink, /Share your experience/, 'footer testimonial action remains readable beside its icon');
  assert.doesNotMatch(footerShareLink, /onClick\s*=/, 'footer testimonial navigation has no router click interception');
  const calls = [];
  const form = harness('app/testimonials/testimonial-form.tsx', async (_, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify(calls.length === 1 ? { error: 'Please try again.' } : { ok: true }), {
      status: calls.length === 1 ? 503 : 201,
    });
  });
  const initial = form.html();
  const homeLink = form.find(node => node.type === 'a' && node.props?.href === '/');
  assert(homeLink && !homeLink.props.onClick, 'form return link uses native browser navigation');
  assert.match(initial, /id="testimonial-consent"[^>]*required=""/, 'publication consent is required');
  assert(!initial.includes('checked=""'), 'publication consent is not preselected');
  assert.match(initial, /PRIVATE · NEVER DISPLAYED/, 'private email label');
  assert.match(initial, /may not be selected/, 'curation disclosure');
  assert.match(initial, /maxLength="2000"/, 'message upper bound');
  assert.match(initial, /minLength="10"/, 'message lower bound');
  assert.match(initial, /Nothing appears on the website automatically/, 'pending-review explanation');
  assert.equal((initial.match(/<option/g) || []).length, 5, 'all shared event types are rendered');
  assert.match(initial, /href="sms:4403961363"/, 'private-feedback alternative');

  populate(form);
  await form.submit();
  form.render();
  assert.equal(form.find(node => node.props?.id === 'testimonial-message').props.value, 'An honest experience about an event.', 'retry preserves input');
  assert.equal(form.find(node => node.props?.role === 'alert').props.children, 'Please try again.', 'server error shown');
  await form.submit();
  form.render();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].submissionId, calls[1].submissionId, 'retry preserves idempotency key');
  assert.match(calls[0].submissionId, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[0].consentVersion, consentVersion, 'visible consent version sent');
  assert.equal(calls[0].consent, true);
  assert(!form.find(node => node.type === 'form'), 'success replaces form');
  assert.match(form.html(), /Your testimonial is pending review/);
  assert.match(form.html(), /Your email stays private/);

  let finish;
  const concurrentCalls = [];
  const repeated = harness('app/testimonials/testimonial-form.tsx', (_, options) => {
    concurrentCalls.push(JSON.parse(options.body));
    return new Promise(resolve => { finish = resolve; });
  });
  populate(repeated);
  const first = repeated.submit();
  await repeated.submit();
  assert.equal(concurrentCalls.length, 1, 'in-flight repeated submit is ignored');
  repeated.render();
  assert.equal(repeated.find(node => node.type === 'fieldset').props.disabled, true, 'fields locked during submission');
  finish(new Response('{"ok":true}', { status: 201 }));
  await first;

  for (const message of [
    'The publication permission has changed. Reload this form and review it before submitting.',
    'An earlier version of this submission was already saved. Contact Zach for an edit; reload only to send a separate testimonial.',
  ]) {
    const conflict = harness('app/testimonials/testimonial-form.tsx', async () => new Response(JSON.stringify({ error: message }), { status: 409 }));
    populate(conflict);
    await conflict.submit();
    conflict.render();
    assert.equal(conflict.find(node => node.props?.role === 'alert').props.children, message, '409 preserves server distinction');
    assert(conflict.find(node => node.type === 'form'), 'conflict preserves form');
  }

  let reads = 0;
  const section = harness('app/testimonials-section.tsx', async () => {
    reads++;
    return new Response(reads === 1 ? '{}' : '[]', { status: reads === 1 ? 503 : 200 });
  });
  assert.match(section.html(), /Loading client testimonials/);
  const shareLink = section.find(node => node.type === 'a' && node.props?.href === '/testimonials');
  assert(shareLink && !shareLink.props.onClick, 'homepage form link uses native browser navigation');
  assert.match(section.html(), /Selected client/);
  assert.match(section.html(), /not a complete collection of customer reviews/);
  assert(!section.html().includes('<blockquote'), 'no made-up quotes while loading');
  await section.effects();
  assert.match(section.html(), /couldn’t load testimonials/);
  const retry = section.find(node => node.type === 'button');
  assert.equal(retry.props.children, 'Try again');
  retry.props.onClick();
  section.render();
  assert.match(section.html(), /Loading client testimonials/, 'retry visibly returns to loading');
  await section.effects();
  assert.equal(reads, 2);
  assert.match(section.html(), /No client testimonials have been published here yet/);
  assert(!section.html().includes('<blockquote'), 'empty state contains no sample quotes');

  const unsafe = '<script>alert("test")</script><img src=x onerror="alert(1)">';
  const selected = harness('app/testimonials-section.tsx', async () => new Response(JSON.stringify([
    { id: 'test-id', displayName: '<svg onload="alert(1)">', eventType: 'Wedding', message: unsafe, publishedAt: '2026-10-22T00:00:00Z' },
  ]), { status: 200 }));
  await selected.effects();
  const rendered = selected.html();
  assert.match(rendered, /<blockquote>/, 'selected testimonial renders');
  assert(!rendered.includes('<script>') && !rendered.includes('<img src=x'), 'testimonial HTML is not executable markup');
  assert.match(rendered, /&lt;script&gt;/, 'message rendered as escaped text');
  assert.match(rendered, /&lt;svg onload=/, 'display name rendered as escaped text');

  const invalid = harness('app/testimonials-section.tsx', async () => new Response('{"unexpected":true}', { status: 200 }));
  await invalid.effects();
  assert.match(invalid.html(), /couldn’t load testimonials/, 'malformed response is not presented as an empty collection');
  console.log('Public testimonial UI unit checks passed: consent/version, privacy, validation bounds, error/retry, idempotency, duplicate-submit guard, pending success, loading/empty/error/selected states and escaped text. No browser or live-service requests.');
})().catch(error => { console.error(error); process.exit(1); });
