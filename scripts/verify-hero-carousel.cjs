// Deterministic component/asset contracts. No browser, network, or customer data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/hero-carousel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const all = (node, predicate) => Array.isArray(node) ? node.flatMap(child => all(child, predicate))
  : !node || typeof node !== 'object' || !node.props ? []
  : [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
const text = node => Array.isArray(node) ? node.map(text).join('')
  : node && typeof node === 'object' ? text(node.props?.children)
  : node == null || typeof node === 'boolean' ? '' : String(node);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event); },
    count() { return [...listeners.values()].reduce((n, group) => n + group.size, 0); },
  };
}

function harness({ reduced = false, visible = true, mount = true } = {}) {
  const slots = [], effects = new Map(), pendingEffects = new Set(), timers = new Map();
  let cursor = 0, tree, dirty = true, now = 0, timerId = 0, mounted = true, focused = -1;
  const media = Object.assign(eventTarget(), { matches: reduced, media: '(prefers-reduced-motion: reduce)' });
  const document = Object.assign(eventTarget(), { hidden: !visible, visibilityState: visible ? 'visible' : 'hidden' });
  const fakeSetTimeout = (fn, delay) => {
    assert.equal(delay, 4000, 'each rotation waits a complete four seconds');
    const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id;
  };
  const fakeClearTimeout = id => { timers.delete(id); };
  const window = { matchMedia(query) { assert.match(query, /prefers-reduced-motion/); return media; }, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout };
  const hooks = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {
        assert.ok(mounted, 'no updates after unmount');
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useEffect(create, deps) {
      const i = cursor++, old = effects.get(i);
      if (!old || !deps || !old.deps || deps.length !== old.deps.length || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
        effects.set(i, { create, deps, cleanup: old?.cleanup }); pendingEffects.add(i);
      }
    },
  };
  const moduleObject = { exports: {} };
  vm.runInNewContext(compiled, {
    module: moduleObject, exports: moduleObject.exports,
    require(name) { return name === 'react' ? hooks : require(name); },
    window, document, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    setInterval() { throw Error('Use one cleaned-up timeout, not a free-running interval.'); },
  });
  const buttons = () => all(tree, node => node.type === 'button');
  const dots = () => buttons().filter(node => String(node.props['aria-label']).startsWith('Show photo '));
  const rotation = () => {
    const found = buttons().filter(node => /^(Pause|Play) automatic photo rotation$/.test(node.props['aria-label']));
    assert.equal(found.length, 1, 'one clearly named rotation control'); return found[0];
  };
  function render() {
    cursor = 0; dirty = false; tree = moduleObject.exports.default();
    dots().forEach((button, i) => button.props.ref?.({ focus() { focused = i; } }));
  }
  function flush(runEffects = true) {
    for (let guard = 0; dirty || (runEffects && pendingEffects.size); guard++) {
      assert.ok(guard < 30, 'component effect/state work settles');
      if (dirty) render();
      if (runEffects) {
        const pending = [...pendingEffects]; pendingEffects.clear();
        for (const i of pending) { const effect = effects.get(i); effect.cleanup?.(); effect.cleanup = effect.create(); }
      }
    }
    assert.ok(timers.size <= 1, 'never more than one scheduled rotation');
    return tree;
  }
  function event(name, args = {}) { assert.equal(typeof tree.props[name], 'function', name + ' is exposed'); tree.props[name](args); flush(); }
  const h = {
    get tree() { return tree; }, buttons, dots, rotation,
    get timerCount() { return timers.size; }, get focused() { return focused; },
    get listenerCount() { return media.count() + document.count(); },
    active() { return dots().findIndex(node => node.props['aria-pressed']); },
    live() { return all(tree, node => node.props.role === 'status')[0]?.props['aria-live']; },
    flush, event,
    clickDot(index) { dots()[index].props.onClick(); flush(); },
    clickRotation() { rotation().props.onClick(); flush(); },
    key(index, key, extra = {}) {
      let prevented = false; focused = -1;
      dots()[index].props.onKeyDown({ key, preventDefault() { prevented = true; }, ...extra }); flush();
      return { prevented, focused };
    },
    hover(value, pointerType = 'mouse') { event(value ? 'onPointerEnter' : 'onPointerLeave', { pointerType }); },
    focus() { event('onFocusCapture'); },
    blur(within = false) { const inside = {}; event('onBlurCapture', { relatedTarget: within ? inside : null, currentTarget: { contains(node) { return node === inside; } } }); },
    visibility(value, dispatch = true) { document.hidden = !value; document.visibilityState = value ? 'visible' : 'hidden'; if (dispatch) document.dispatch('visibilitychange'); flush(); },
    reduce(value) { media.matches = value; media.dispatch('change', { matches: value }); flush(); },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; ; guard++) {
        assert.ok(guard < 1000, 'finite timer work');
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); flush();
      }
      now = end;
    },
    strictReplay() {
      for (const effect of effects.values()) { effect.cleanup?.(); effect.cleanup = undefined; }
      assert.equal(timers.size, 0, 'StrictMode cleanup clears timers');
      assert.equal(media.count() + document.count(), 0, 'StrictMode cleanup removes listeners');
      for (const index of effects.keys()) pendingEffects.add(index);
      flush();
    },
    unmount() {
      for (const effect of effects.values()) effect.cleanup?.();
      mounted = false;
      assert.equal(timers.size, 0, 'unmount clears pending rotation');
      assert.equal(media.count() + document.count(), 0, 'unmount removes environment listeners');
    },
  };
  flush(mount);
  return h;
}

function expectActive(h, index) {
  assert.equal(h.active(), index);
  const slides = all(h.tree, node => node.props['aria-roledescription'] === 'slide');
  assert.deepEqual(slides.map(node => node.props['aria-hidden']), [index !== 0, index !== 1]);
  assert.match(renderToStaticMarkup(h.tree), new RegExp(`Photo ${index + 1} of 2:`));
}
function expectRunning(h, running) { assert.equal(h.timerCount, running ? 1 : 0); assert.equal(h.live(), running ? 'off' : 'polite'); }
function pointer(x, y, extra = {}) {
  return { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    target: { closest() { return null; } }, ...extra };
}
function swipe(h, from, to) { h.event('onPointerDown', from); h.event('onPointerUp', to); }

// SSR and initial image remain deterministic; effects opt in only after mounting.
const ssr = harness({ mount: false });
expectActive(ssr, 0); expectRunning(ssr, false);
assert.equal(ssr.rotation().props['aria-label'], 'Play automatic photo rotation');
const images = all(ssr.tree, node => node.type === 'img');
assert.deepEqual(images.map(node => node.props.src), ['/images/wedding.webp', '/images/zach-at-the-decks.webp']);
assert.equal(ssr.buttons().length, 3);
assert.equal(ssr.buttons()[0], ssr.rotation(), 'rotation control precedes the dots');
assert.equal(all(ssr.tree, node => node.type === 'a').length, 0, 'no decorative arrow control');
assert.ok(images.every(node => node.props.width > 0 && node.props.height > 0 && node.props.alt));
assert.equal(images[0].props.fetchPriority, 'high'); assert.equal(images[1].props.fetchPriority, 'low');
assert.match(text(ssr.rotation()), /Play/);
ssr.unmount();

// Exactly four seconds per photo; pause/play never accumulates duplicate timers.
const timed = harness();
expectActive(timed, 0); expectRunning(timed, true);
assert.equal(timed.rotation().props['aria-label'], 'Pause automatic photo rotation');
assert.match(text(timed.rotation()), /Pause/);
timed.advance(3999); expectActive(timed, 0);
timed.advance(1); expectActive(timed, 1); expectRunning(timed, true);
timed.advance(4000); expectActive(timed, 0);
timed.advance(12000); expectActive(timed, 1);
for (let i = 0; i < 8; i++) {
  timed.clickRotation(); expectRunning(timed, false);
  const current = timed.active(); timed.advance(10000); expectActive(timed, current);
  timed.clickRotation(); expectRunning(timed, true);
  timed.advance(3999); expectActive(timed, current);
  timed.advance(1); expectActive(timed, 1 - current);
}
timed.strictReplay(); expectRunning(timed, true);
assert.equal(timed.listenerCount, 2, 'one media and one visibility listener after StrictMode replay');
timed.advance(4000); expectRunning(timed, true); timed.unmount();

// Hover/focus suspend temporarily; resume gets a fresh full interval.
const paused = harness();
paused.hover(true, 'touch'); expectRunning(paused, true);
paused.hover(false, 'touch'); expectRunning(paused, true);
paused.advance(3000); paused.hover(true); expectRunning(paused, false);
paused.advance(8000); expectActive(paused, 0);
paused.hover(false); expectRunning(paused, true);
paused.advance(3999); expectActive(paused, 0); paused.advance(1); expectActive(paused, 1);
paused.focus(); expectRunning(paused, false);
paused.blur(true); expectRunning(paused, false); paused.advance(8000); expectActive(paused, 1);
paused.hover(true); paused.blur(); expectRunning(paused, false);
paused.hover(false); expectRunning(paused, true);
paused.advance(3999); expectActive(paused, 1); paused.advance(1); expectActive(paused, 0);
// Explicit Play opts back in without forcibly blurring the focused control.
paused.clickRotation(); paused.focus(); paused.clickRotation(); expectRunning(paused, true);
assert.equal(paused.focused, -1, 'Play does not move DOM focus');
paused.advance(3999); expectActive(paused, 0); paused.advance(1); expectActive(paused, 1);
// Moving focus to another control after Play suspends rotation again.
paused.focus(); expectRunning(paused, false); paused.advance(8000); expectActive(paused, 1);
paused.blur(true); expectRunning(paused, false);
paused.blur(); expectRunning(paused, true);
paused.advance(3999); expectActive(paused, 1); paused.advance(1); expectActive(paused, 0);
// A mouse click on Play still respects hover, but mouseleave needs no extra blur.
paused.clickRotation(); paused.focus(); paused.hover(true); paused.clickRotation(); expectRunning(paused, false);
paused.advance(8000); expectActive(paused, 0);
paused.hover(false); expectRunning(paused, true);
paused.advance(3999); expectActive(paused, 0); paused.advance(1); expectActive(paused, 1);
paused.unmount();

// Hidden tabs do not advance or catch up; reduced motion requires explicit opt-in.
const visibility = harness({ visible: false });
expectRunning(visibility, false); visibility.advance(12000); expectActive(visibility, 0);
visibility.visibility(true); expectRunning(visibility, true);
visibility.advance(2000); visibility.visibility(false); expectRunning(visibility, false);
visibility.advance(20000); expectActive(visibility, 0);
visibility.visibility(true); visibility.advance(3999); expectActive(visibility, 0); visibility.advance(1); expectActive(visibility, 1);
// Explicit Play overrides focus, never the hidden-tab safeguard.
visibility.clickRotation(); visibility.visibility(false); visibility.focus(); visibility.clickRotation(); expectRunning(visibility, false);
visibility.advance(8000); expectActive(visibility, 1);
visibility.visibility(true); expectRunning(visibility, true);
visibility.advance(3999); expectActive(visibility, 1); visibility.advance(1); expectActive(visibility, 0);
visibility.unmount();
// Timer callback also fails safe if the browser hides before dispatching its event.
const visibilityRace = harness();
visibilityRace.visibility(false, false); visibilityRace.advance(4000);
expectActive(visibilityRace, 0); expectRunning(visibilityRace, false);
visibilityRace.visibility(true); visibilityRace.advance(3999); expectActive(visibilityRace, 0);
visibilityRace.advance(1); expectActive(visibilityRace, 1); visibilityRace.unmount();
const reduced = harness({ reduced: true });
expectRunning(reduced, false); reduced.advance(8000); expectActive(reduced, 0);
reduced.clickRotation(); expectRunning(reduced, true); reduced.advance(4000); expectActive(reduced, 1);
reduced.reduce(false); reduced.reduce(true); expectRunning(reduced, false);
reduced.reduce(false); expectRunning(reduced, false); reduced.advance(8000); expectActive(reduced, 1);
reduced.clickRotation(); expectRunning(reduced, true); reduced.advance(4000); expectActive(reduced, 0);
reduced.unmount();

// Manual selection/keyboard/touch stops rotation until Play is explicitly chosen.
const manual = harness();
manual.clickDot(0); expectActive(manual, 0); expectRunning(manual, false);
for (let i = 0; i < 12; i++) { manual.clickDot(i % 2); expectActive(manual, i % 2); expectRunning(manual, false); }
for (const [index, key, expected] of [[0, 'ArrowRight', 1], [1, 'ArrowRight', 0], [0, 'ArrowLeft', 1], [1, 'ArrowLeft', 0], [0, 'End', 1], [1, 'Home', 0]]) {
  manual.clickRotation(); expectRunning(manual, true);
  const result = manual.key(index, key); expectActive(manual, expected); expectRunning(manual, false);
  assert.equal(result.prevented, true); assert.equal(result.focused, expected);
}
assert.equal(manual.key(0, 'Tab').prevented, false, 'normal keyboard navigation is untouched');
manual.clickRotation();
for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    const result = manual.key(1, key, { [modifier]: true }); expectActive(manual, 0); expectRunning(manual, true);
    assert.equal(result.prevented, false, `${modifier}+${key} retains its browser behavior`); assert.equal(result.focused, -1);
  }
}
manual.event('onPointerDown', pointer(250, 200)); expectRunning(manual, false);
manual.advance(8000); expectActive(manual, 0);
manual.event('onPointerUp', pointer(100, 205)); expectActive(manual, 1);
swipe(manual, pointer(100, 200), pointer(250, 205)); expectActive(manual, 0);
swipe(manual, pointer(250, 200), pointer(100, 205)); expectActive(manual, 1);
swipe(manual, pointer(250, 200), pointer(100, 205)); expectActive(manual, 0);
for (const [from, to] of [
  [pointer(250, 200), pointer(249, 350)],
  [pointer(250, 200), pointer(230, 205)],
  [pointer(250, 200), pointer(150, 300)],
  [pointer(250, 200), pointer(100, 205, { pointerId: 2 })],
  [pointer(250, 200, { isPrimary: false }), pointer(100, 205)],
  [pointer(250, 200, { pointerType: 'mouse' }), pointer(100, 205)],
  [pointer(250, 200, { target: { closest() { return {}; } } }), pointer(100, 205)],
]) { swipe(manual, from, to); expectActive(manual, 0); }
manual.event('onPointerDown', pointer(250, 200)); manual.event('onPointerCancel');
manual.event('onPointerUp', pointer(100, 205)); expectActive(manual, 0);
manual.event('onPointerDown', pointer(250, 200)); manual.event('onPointerDown', pointer(200, 200, { isPrimary: false, pointerId: 2 }));
manual.event('onPointerUp', pointer(100, 205)); expectActive(manual, 0);
manual.hover(true); manual.hover(false); manual.focus(); manual.blur(); manual.visibility(false); manual.visibility(true);
expectRunning(manual, false); manual.advance(8000); expectActive(manual, 0);
manual.clickRotation(); expectRunning(manual, true); manual.advance(4000); expectActive(manual, 1); manual.unmount();

// Existing image/crop/layout/privacy contracts remain unchanged by autoplay.
assert.doesNotMatch(source, /setInterval/);
const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
assert.match(css, /touch-action:pan-y pinch-zoom/);
assert.match(css, /\.hero-carousel \.hero-slide\{position:absolute;inset:0/);
assert.match(css, /prefers-reduced-motion:reduce[^}]*\.hero-carousel \.hero-slide[^}]*transition:none/);
assert.match(css, /\.hero-photo-dot\{[^}]*width:44px;height:44px/);
assert.match(css, /\.hero-photo-dot:focus-visible/);
assert.match(css, /\.hero-photo-playback\{[^}]*width:62px;height:44px/);
assert.match(css, /\.hero-photo-playback:focus-visible/);
assert.match(css, /\.hero-slide-zach img\{object-position:32% 50%/);
const wedding = fs.readFileSync(path.join(root, 'public/images/wedding.webp'));
const blobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
assert.equal(blobSha(wedding), '9116dcce6da7f5f28516c6a4b3495566002aa58b', 'original couple image unchanged');
const zach = fs.readFileSync(path.join(root, 'public/images/zach-at-the-decks.webp'));
assert.equal(zach.toString('ascii', 0, 4), 'RIFF'); assert.equal(zach.toString('ascii', 8, 12), 'WEBP');
assert.ok(zach.length < 200000);
for (let at = 12; at + 8 <= zach.length;) {
  const kind = zach.toString('ascii', at, at + 4);
  assert.ok(!['EXIF', 'XMP '].includes(kind), 'public derivative strips private metadata');
  const size = zach.readUInt32LE(at + 4); at += 8 + size + (size % 2);
}
console.log('Hero carousel passed: SSR couple-first; exact four-second loop; pause/play; hover/focus/hidden/reduced-motion suspension; fresh resume intervals; manual override; keyboard/swipe guards; one timer; StrictMode/unmount cleanup; unchanged crops/assets and metadata-free photo. Browser/touch-device rendering is separate.');
