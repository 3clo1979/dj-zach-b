// Local deterministic component harness. No browser, server, or real customer data.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const slots = [], effects = [];
let cursor = 0, initial = true, confirmed = true, pendingCount = null, posts = 0;
let rows = [{ id:'qa-only', displayName:'QA <img src=x onerror=alert(1)>', email:'private@example.invalid', eventType:'Wedding', message:'<script>alert("unsafe")</script> Original local-only test experience.', status:'Pending', createdAt:'2026-10-20T12:00:00Z', updatedAt:'2026-10-20T12:00:00Z', publishedAt:null, moderatedAt:null, moderatedBy:null, consentAt:'2026-10-20T12:00:00Z', consentVersion:'v1' }];
const original = { ...rows[0] };
let unauthorized = false, conflict = false, networkFailure = false, releasePost = null;
const hooks = {
  useState(value) { const i=cursor++; if(!(i in slots))slots[i]=typeof value==='function'?value():value; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}]; },
  useRef(value) { const i=cursor++; if(!(i in slots))slots[i]={current:value}; return slots[i]; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn) { cursor++; if(initial)effects.push(fn); },
};
async function fetchMock(_url, options={}) {
  if (unauthorized) return Response.json({error:'Manager sign-in required.'},{status:403});
  if(options.method==='POST') {
    posts++;
    const body=JSON.parse(options.body);
    assert.equal(body.expectedUpdatedAt,rows[0].updatedAt,'version included in mutation');
    if(networkFailure) throw new Error('Local simulated connection interruption.');
    if(conflict){conflict=false;rows=[{...rows[0],updatedAt:'2026-10-21T13:00:00Z'}];return Response.json({error:'Stale'},{status:409});}
    rows=[{...rows[0],status:body.status,updatedAt:new Date().toISOString(),publishedAt:body.status==='Published'?new Date().toISOString():null}];
    if(releasePost===true)await new Promise(resolve=>{releasePost=resolve;});
    return Response.json({ok:true});
  }
  return Response.json(rows);
}
const moduleObject={exports:{}};
const source=ts.transpileModule(fs.readFileSync('app/studio/testimonials-panel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(source,{module:moduleObject,exports:moduleObject.exports,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);if(name.endsWith('.css'))return {};throw Error(name);},fetch:fetchMock,window:{confirm:()=>confirmed},Response,AbortController,Date,Number,Array,Error,encodeURIComponent,setTimeout,clearTimeout});
const Panel=moduleObject.exports.default;
const onPendingCountChange=value=>{pendingCount=value;};
const render=()=>{cursor=0;const result=Panel({active:false,onPendingCountChange});initial=false;return result;};
const elements=(node,predicate)=>{if(Array.isArray(node))return node.flatMap(x=>elements(x,predicate));if(!node||typeof node!=='object'||!node.props)return [];return [...(predicate(node)?[node]:[]),...elements(node.props.children,predicate)];};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null?'':String(node);
const button=(tree,label)=>{const exact=elements(tree,node=>node.type==='button'&&text(node)===label);const found=exact.length?exact:elements(tree,node=>node.type==='button'&&text(node).includes(label));assert.equal(found.length,1,`one button matching ${label}`);return found[0];};
const html=tree=>renderToStaticMarkup(tree);
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
(async()=>{
  let tree=render();assert.match(html(tree),/Loading testimonials/);
  const cleanups=effects.map(effect=>effect());await settle();tree=render();
  assert.equal(pendingCount,1);assert.match(html(tree),/private@example.invalid/);
  assert.match(html(tree),/&lt;script&gt;/,'submission HTML escaped');assert.match(html(tree),/&lt;img/,'display name escaped');assert.doesNotMatch(html(tree),/<script|<img/);
  confirmed=false;button(tree,'Publish on website').props.onClick();await settle();assert.equal(posts,0,'cancel does not mutate');
  confirmed=true;releasePost=true;const publish=button(tree,'Publish on website');publish.props.onClick();publish.props.onClick();await settle();tree=render();
  assert.equal(posts,1,'immediate duplicate click guarded');assert.equal(button(tree,'Archive').props.disabled,true,'action buttons disabled during mutation');
  releasePost();releasePost=null;await settle();tree=render();assert.equal(pendingCount,0);assert.match(html(tree),/Published on the website/);
  button(tree,'Published 1').props.onClick();tree=render();button(tree,'Unpublish').props.onClick();await settle();tree=render();assert.equal(pendingCount,1);
  button(tree,'Pending 1').props.onClick();tree=render();conflict=true;button(tree,'Publish on website').props.onClick();await settle();tree=render();assert.match(html(tree),/changed in another session/);assert.equal(rows[0].status,'Pending','conflict does not silently publish');
  button(tree,'Archive').props.onClick();await settle();tree=render();button(tree,'Archived 1').props.onClick();tree=render();button(tree,'Restore to Pending').props.onClick();await settle();tree=render();assert.equal(pendingCount,1);button(tree,'Pending 1').props.onClick();tree=render();
  unauthorized=true;button(tree,'Reload list').props.onClick();await settle();tree=render();assert.match(html(tree),/Manager sign-in required/);assert.doesNotMatch(html(tree),/private@example.invalid|Publish on website/,'403 removes private content and actions');assert.equal(pendingCount,null);
  unauthorized=false;button(tree,'Try again').props.onClick();await settle();tree=render();assert.match(html(tree),/private@example.invalid/,'retry restores successful load');
  networkFailure=true;button(tree,'Publish on website').props.onClick();await settle();tree=render();assert.match(html(tree),/may already be saved/);assert.doesNotMatch(html(tree),/private@example.invalid|Publish on website/,'uncertain mutation requires reload');
  assert.equal(rows[0].message,original.message,'moderation never edits words');
  cleanups.forEach(cleanup=>cleanup?.());
  console.log('Testimonial Studio UI checks passed: loading, text escaping, confirmation cancel, immediate duplicate guard, busy controls, publish/unpublish/archive/restore, versioned writes, stale refresh, 403 privacy clearing, retry, uncertain write notice, pending counts, original wording.');
})().catch(error=>{console.error(error);process.exitCode=1;});
