function lum(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((l1 + 0.05) / (l2 + 0.05)).toFixed(1);
}
function blend(fgHex, alpha, bgHex) {
  const p = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const [fr, fg2, fb] = p(fgHex),
    [br, bg2, bb] = p(bgHex);
  const m = (f, b) => Math.round(f * alpha + b * (1 - alpha));
  return (
    '#' + [m(fr, br), m(fg2, bg2), m(fb, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')
  );
}
const paper = {
  ground: '#F4F3EE',
  panel: '#FBFAF7',
  text: '#1F1E1A',
  sec: '#6B6960',
  accent: '#7A5800',
  wash: '#FFDF8E',
  success: '#3E6B43',
  danger: '#9C3D33',
};
const ink = {
  ground: '#14130F',
  panel: '#1C1B16',
  text: '#ECEAE2',
  sec: '#A09D92',
  accent: '#E9C46A',
  success: '#93BC93',
  danger: '#DC9286',
};
const inkWashOverPanel = blend('#FFD66B', 0.16, ink.panel);
console.log('PAPER');
console.log('text/ground', ratio(paper.text, paper.ground));
console.log('text/panel', ratio(paper.text, paper.panel));
console.log('sec/ground', ratio(paper.sec, paper.ground));
console.log('sec/panel', ratio(paper.sec, paper.panel));
console.log('accent/ground', ratio(paper.accent, paper.ground));
console.log('text/wash', ratio(paper.text, paper.wash));
console.log('danger/ground', ratio(paper.danger, paper.ground));
console.log('success/ground', ratio(paper.success, paper.ground));
console.log('INK');
console.log('text/ground', ratio(ink.text, ink.ground));
console.log('text/panel', ratio(ink.text, ink.panel));
console.log('sec/ground', ratio(ink.sec, ink.ground));
console.log('sec/panel', ratio(ink.sec, ink.panel));
console.log('accent/ground', ratio(ink.accent, ink.ground));
console.log(
  'text/washOverPanel',
  ratio(ink.text, inkWashOverPanel),
  '(wash blend =',
  inkWashOverPanel + ')',
);
console.log('danger/ground', ratio(ink.danger, ink.ground));
console.log('success/ground', ratio(ink.success, ink.ground));
