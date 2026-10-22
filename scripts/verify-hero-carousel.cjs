// Local component/asset contracts. No browser or network and no customer data.
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
const slots = [];
let cursor = 0, tree;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleObject, exports: moduleObject.exports,
  require(name) {
    if (name === 'react') return {
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    };
    return require(name);
  },
  setTimeout() { throw Error('The hero must not auto-advance.'); },
  setInterval() { throw Error('The hero must not auto-advance.'); },
});
const render = () => { cursor = 0; tree = moduleObject.exports.default(); return tree; };
const all = (node, predicate) => Array.isArray(node) ? node.flatMap(child => all(child, predicate))
  : !node || typeof node !== 'object' || !node.props ? []
  : [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
const buttons = () => all(tree, node => node.type === 'button');
const slides = () => all(tree, node => node.props['aria-roledescription'] === 'slide');
const selected = () => buttons().findIndex(node => node.props['aria-pressed']);
function expectActive(index) {
  assert.equal(selected(), index);
  assert.deepEqual(slides().map(node => node.props['aria-hidden']), [index !== 0, index !== 1]);
  assert.match(renderToStaticMarkup(tree), new RegExp(`Photo ${index + 1} of 2:`));
}
render();
expectActive(0);
const images = all(tree, node => node.type === 'img');
assert.deepEqual(images.map(node => node.props.src), ['/images/wedding.webp', '/images/zach-at-the-decks.webp']);
assert.equal(buttons().length, 2);
assert.equal(all(tree, node => node.type === 'a').length, 0, 'no decorative arrow control');
assert.ok(images.every(node => node.props.width > 0 && node.props.height > 0 && node.props.alt));
assert.equal(images[0].props.fetchPriority, 'high');
assert.equal(images[1].props.fetchPriority, 'low');
for (let i = 0; i < 12; i++) {
  buttons()[i % 2].props.onClick(); render(); expectActive(i % 2);
}
for (const [index, key, expected] of [[0, 'ArrowRight', 1], [1, 'ArrowRight', 0], [0, 'ArrowLeft', 1], [1, 'ArrowLeft', 0], [0, 'End', 1], [1, 'Home', 0]]) {
  let prevented = false, focused = -1;
  buttons().forEach((button, i) => button.props.ref({ focus() { focused = i; } }));
  buttons()[index].props.onKeyDown({ key, preventDefault() { prevented = true; } });
  render(); expectActive(expected);
  assert.equal(prevented, true); assert.equal(focused, expected);
}
let tabPrevented = false;
buttons()[0].props.onKeyDown({ key: 'Tab', preventDefault() { tabPrevented = true; } });
assert.equal(tabPrevented, false, 'normal keyboard navigation is untouched');
function pointer(x, y, extra = {}) {
  return { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    target: { closest() { return null; } }, ...extra };
}
function swipe(from, to) { tree.props.onPointerDown(from); tree.props.onPointerUp(to); render(); }
swipe(pointer(250, 200), pointer(100, 205)); expectActive(1);
swipe(pointer(100, 200), pointer(250, 205)); expectActive(0);
swipe(pointer(250, 200), pointer(100, 205)); expectActive(1);
swipe(pointer(250, 200), pointer(100, 205)); expectActive(0);
for (const [from, to] of [
  [pointer(250, 200), pointer(249, 350)],
  [pointer(250, 200), pointer(230, 205)],
  [pointer(250, 200), pointer(150, 300)],
  [pointer(250, 200), pointer(100, 205, { pointerId: 2 })],
  [pointer(250, 200, { isPrimary: false }), pointer(100, 205)],
  [pointer(250, 200, { pointerType: 'mouse' }), pointer(100, 205)],
  [pointer(250, 200, { target: { closest() { return {}; } } }), pointer(100, 205)],
]) { swipe(from, to); expectActive(0); }
tree.props.onPointerDown(pointer(250, 200));
tree.props.onPointerCancel();
tree.props.onPointerUp(pointer(100, 205)); render(); expectActive(0);
tree.props.onPointerDown(pointer(250, 200));
tree.props.onPointerDown(pointer(200, 200, { isPrimary: false, pointerId: 2 }));
tree.props.onPointerUp(pointer(100, 205)); render(); expectActive(0);
assert.doesNotMatch(source, /setInterval|setTimeout|autoPlay/);
const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
assert.match(css, /touch-action:pan-y pinch-zoom/);
assert.match(css, /\.hero-carousel \.hero-slide\{position:absolute;inset:0/);
assert.match(css, /prefers-reduced-motion:reduce[^}]*\.hero-carousel \.hero-slide[^}]*transition:none/);
assert.match(css, /\.hero-photo-dot\{[^}]*width:44px;height:44px/);
assert.match(css, /\.hero-photo-dot:focus-visible/);
assert.match(css, /\.hero-slide-zach img\{object-position:32% 50%/);
const wedding = fs.readFileSync(path.join(root, 'public/images/wedding.webp'));
const blobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
assert.equal(blobSha(wedding), '9116dcce6da7f5f28516c6a4b3495566002aa58b', 'original couple image unchanged');
const zach = fs.readFileSync(path.join(root, 'public/images/zach-at-the-decks.webp'));
assert.equal(zach.toString('ascii', 0, 4), 'RIFF');
assert.equal(zach.toString('ascii', 8, 12), 'WEBP');
assert.ok(zach.length < 200000);
for (let at = 12; at + 8 <= zach.length;) {
  const kind = zach.toString('ascii', at, at + 4);
  assert.ok(!['EXIF', 'XMP '].includes(kind), 'public derivative strips private metadata');
  const size = zach.readUInt32LE(at + 4); at += 8 + size + (size % 2);
}
console.log('Hero carousel: couple-first order; repeated dots; keyboard wrap/focus; touch swipe; vertical/short/multi-touch/cancel guards; no autoplay; reduced-motion/layout CSS; unchanged couple bytes; metadata-free web photo passed. Browser/touch-device rendering is separate.');
