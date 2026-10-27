// Synthetic fixture only. Dependencies are real ESM inputs supplied by the audited entry.
export function mountFixture({ React, createRoot, flushSync, Portal, Drawer, SiderMenu, EscapeContext }) {
  const h = React.createElement;
  const originalAdd = window.addEventListener.bind(window), originalRemove = window.removeEventListener.bind(window);
  const tracked = new Map([['keydown', new Map()], ['compositionend', new Map()]]);
  const captureValue = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
  window.addEventListener = (type, fn, options) => { const entries = tracked.get(type); if (entries) { if (!entries.has(fn)) entries.set(fn, new Set()); entries.get(fn).add(captureValue(options)); } return originalAdd(type, fn, options); };
  window.removeEventListener = (type, fn, options) => { const entries = tracked.get(type); entries?.get(fn)?.delete(captureValue(options)); if (!entries?.get(fn)?.size) entries?.delete(fn); return originalRemove(type, fn, options); };
  let root, requestedPhase = 0, committedPhase = -1, scenario = 'drawers', calls = [], events = [], overflow = false, pendingRenders = 0, lastComposition = null;
  const committed = new Set(), nodes = {}, replay = { A: 0, B: 0 }, focusAtOpen = { parent: null, child: null };
  const record = (target, value) => { if (target.length >= 64) { overflow = true; return; } target.push(value); };
  const focus = () => ['open-parent', 'open-child', 'key-target'].includes(document.activeElement?.id) ? document.activeElement.id : document.activeElement?.closest('[role="dialog"]') ? 'drawer' : document.activeElement === document.body ? 'body' : 'other';
  const keydown = event => { if (['Escape', 'Enter', 'Tab'].includes(event.key)) record(events, { type: 'keydown', key: event.key, classification: event.isTrusted ? 'native' : 'simulated', composing: event.isComposing, focus: focus(), imeRecent: lastComposition !== null && Date.now() - lastComposition >= 0 && Date.now() - lastComposition < 200 }); };
  const compositionend = () => { lastComposition = Date.now(); record(events, { type: 'compositionend', classification: 'simulated-control' }); };
  window.addEventListener('keydown', keydown, true); window.addEventListener('compositionend', compositionend);
  function Marker({ name }) { React.useLayoutEffect(() => { committed.add(name); return () => committed.delete(name); }, [name]); return h('span', { 'data-marker': name }); }
  function Capture({ name }) { const value = React.useContext(EscapeContext); React.useLayoutEffect(() => { nodes[name] = value; }); return null; }
  function Count({ name }) { React.useLayoutEffect(() => { replay[name]++; }, []); return null; }
  const callback = name => ({ top }) => record(calls, { name, top });
  function P({ name, open = true, children, onEsc, ...rest }) { return h(Portal, { open, onEsc: onEsc || callback(name), ...rest }, h(React.Fragment, null, h(Marker, { name }), children)); }
  const keyed = (name, open = true) => h(P, { name, open, key: name });
  const never = new Promise(() => {});
  function Pending() { pendingRenders++; throw never; }
  const prepareOpener = event => { const pointer = event.nativeEvent.detail > 0; if (pointer) event.currentTarget.focus(); return pointer ? 'fixture-trigger-focus-before-open' : 'targeted-native-Enter'; };
  function NativeDrawers() {
    const [parent, setParent] = React.useState(false), [child, setChild] = React.useState(false);
    return h(React.Fragment, null,
      h('button', { id: 'open-parent', onClick: event => { const focusSetup = prepareOpener(event); focusAtOpen.parent = document.activeElement; record(events, { type: 'open-parent', classification: event.nativeEvent.isTrusted ? 'native' : 'simulated', detail: event.nativeEvent.detail, focus: focus(), focusSetup }); setParent(true); } }, 'Open parent'),
      h(Drawer, { title: 'Parent', open: parent, onClose: () => { record(calls, { name: 'closed-parent' }); setParent(false); } },
        h('button', { id: 'open-child', onClick: event => { const focusSetup = prepareOpener(event); focusAtOpen.child = document.activeElement; record(events, { type: 'open-child', classification: event.nativeEvent.isTrusted ? 'native' : 'simulated', detail: event.nativeEvent.detail, focus: focus(), focusSetup }); setChild(true); } }, 'Open child'),
        h(Drawer, { title: 'Child', open: child, onClose: () => { record(calls, { name: 'closed-child' }); setChild(false); } }, 'Synthetic child')));
  }
  function Scene({ phase, name }) {
    React.useLayoutEffect(() => { committedPhase = phase; }, [phase]);
    if (name === 'drawers') return h(NativeDrawers);
    if (name === 'siblings') return h(React.Fragment, null, keyed('A'), keyed('B', phase === 1 || phase >= 3), phase >= 2 && keyed('C'));
    if (name === 'nested') return h(P, { name: 'parent' }, keyed('child'));
    if (name === 'aborted-open') return h(React.Fragment, null, keyed('A'), h(React.Suspense, { fallback: h('i') }, h(P, { name: 'pending' }, h(Pending))));
    if (name === 'aborted-close') return h(React.Fragment, null, keyed('A', phase === 0), phase > 0 && h(Pending));
    if (name === 'aborted-callback') return h(React.Fragment, null, h(P, { name: 'A', onEsc: callback(phase ? 'abandoned' : 'committed') }), phase > 0 && h(Pending));
    if (name === 'reparent' || name === 'aborted-reparent') {
      const aborted = name === 'aborted-reparent', parent = aborted ? (phase >= 4 ? 'B' : 'A') : (phase >= 2 ? 'B' : 'A');
      const aOpen = aborted ? phase !== 2 : phase !== 3;
      return h(React.Fragment, null,
        h(P, { name: 'A', key: 'A', open: aOpen, autoDestroy: false }, h(Capture, { name: 'A' })),
        h(P, { name: 'B', key: 'B' }, h(Capture, { name: 'B' })),
        phase > 0 && h(React.Fragment, null, h(EscapeContext.Provider, { value: nodes[parent] }, keyed('child')), aborted && phase >= 4 && h(Pending)));
    }
    if (name === 'isolated-replay') return h(React.Fragment, null,
      h(React.StrictMode, null, h(React.Activity, { mode: phase === 2 ? 'hidden' : 'visible' }, h(P, { name: 'A' }, h(Count, { name: 'A' })))),
      phase > 0 && h(P, { name: 'B' }, h(Count, { name: 'B' })));
    if (name === 'omitted') return h(React.Fragment, null, keyed('A'), h(Portal, { open: true }, h('i')));
    if (name === 'keyboard-false') return h(React.Fragment, null, h(Drawer, { open: true, title: 'A', onClose: callback('closed-A') }, 'A'), h(Drawer, { open: true, keyboard: false, title: 'B', onClose: callback('closed-B') }, 'B'));
    if (name === 'ime') return keyed('A');
    if (name === 'prolayout-inline') return h(SiderMenu, { isMobile: true, collapsed: false, prefixCls: 'ant-pro', siderWidth: 200, matchMenuKeys: [], menuData: [], onCollapse: value => record(calls, { name: 'collapse', value }) });
    throw Error('Unknown fixture scenario');
  }
  const host = document.getElementById('root');
  const render = () => root.render(h(React.Suspense, { fallback: h('b') }, h(Scene, { name: scenario, phase: requestedPhase })));
  function configure(name) {
    if (!['drawers', 'siblings', 'nested', 'aborted-open', 'aborted-close', 'aborted-callback', 'reparent', 'aborted-reparent', 'isolated-replay', 'omitted', 'keyboard-false', 'ime', 'prolayout-inline'].includes(name)) throw Error('Unknown fixture scenario');
    if (root) flushSync(() => root.unmount());
    scenario = name; requestedPhase = 0; committedPhase = -1; calls = []; events = []; pendingRenders = 0; committed.clear(); overflow = false; lastComposition = null; replay.A = replay.B = 0; focusAtOpen.parent = focusAtOpen.child = null;
    root = createRoot(host, { onUncaughtError: () => { overflow = true; }, onRecoverableError: () => { overflow = true; } }); flushSync(render);
  }
  const advance = () => { requestedPhase++; if ((scenario === 'aborted-close' || scenario === 'aborted-callback') && requestedPhase > 0 || scenario === 'aborted-reparent' && requestedPhase >= 4) React.startTransition(render); else flushSync(render); };
  function snapshot() { const value = { scenario, requestedPhase, committedPhase, calls: calls.slice(), events: events.slice(), committed: [...committed], pendingRenders, replay: { ...replay }, overflow, focus: focus(), restoredFocus: Object.fromEntries(Object.entries(focusAtOpen).map(([name, node]) => [name, Boolean(node) && node === document.activeElement])), savedFocusConnected: Object.fromEntries(Object.entries(focusAtOpen).map(([name, node]) => [name, Boolean(node?.isConnected)])), imePast: lastComposition !== null && Date.now() - lastComposition >= 200 }; if (JSON.stringify(value).length > 8192) throw Error('Fixture byte cap exceeded'); return value; }
  function dispose() {
    if (root) { flushSync(() => root.unmount()); root = null; }
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('compositionend', compositionend);
    const remaining = Object.fromEntries([...tracked].map(([type, entries]) => [type, [...entries.values()].reduce((n, values) => n + values.size, 0)]));
    window.addEventListener = originalAdd; window.removeEventListener = originalRemove;
    return { remaining, overflow, componentDisposed: true };
  }
  window.portalEscapeFixture = Object.freeze({ configure, advance, snapshot, dispose, reactVersion: React.version });
  configure('drawers');
}
