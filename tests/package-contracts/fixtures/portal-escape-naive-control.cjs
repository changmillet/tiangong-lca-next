// Deliberately incorrect control: child effects precede parent effects.
Object.defineProperty(exports, '__esModule', { value: true });
const React = require('react');
const stack = [];
exports.EscapeContext = React.createContext(null);
const keydown = event => {
  if (event.key === 'Escape') stack.slice().reverse().forEach((node, index) => node.onEsc?.({ top: index === 0, event }));
};
exports.default = function naiveEffect(open, onEsc) {
  const node = React.useRef({}).current;
  React.useEffect(() => {
    node.onEsc = onEsc;
    if (open) { stack.push(node); window.addEventListener('keydown', keydown); }
    return () => { const index = stack.indexOf(node); if (index >= 0) stack.splice(index, 1); if (!stack.length) window.removeEventListener('keydown', keydown); };
  }, [open, onEsc]);
  return node;
};
