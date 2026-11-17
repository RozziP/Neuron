const keys = {};
for (let i = 0; i < 26; i++) keys[String.fromCharCode(65 + i)] = [4 + i, 65 + i];
for (let i = 0; i < 10; i++) keys['1234567890'[i]] = [30 + i, '1234567890'.charCodeAt(i)];
for (let i = 1; i <= 24; i++) keys[`F${i}`] = [i <= 12 ? 57 + i : 91 + i, 111 + i];
Object.assign(keys, {
  ENTER: [40,13], ESCAPE: [41,27], BACKSPACE: [42,8], TAB: [43,9], SPACE: [44,32], CAPS: [57,20], CAPSLOCK: [57,20],
  '-': [45,189], '=': [46,187], '[': [47,219], ']': [48,221], '\\': [49,220],
  ';': [51,186], "'": [52,222], '`': [53,192], ',': [54,188], '.': [55,190], '/': [56,191],
  INSERT: [73,45], HOME: [74,36], PAGEUP: [75,33], DELETE: [76,46], END: [77,35], PAGEDOWN: [78,34],
  ARROWRIGHT: [79,39], ARROWLEFT: [80,37], ARROWDOWN: [81,40], ARROWUP: [82,38]
});
const modifiers = { CTRL: [1,17], SHIFT: [2,16], ALT: [4,18], WIN: [8,91] };
function parseChord(text) {
  if (typeof text !== 'string' || text.length > 80) throw new Error('Enter a key or shortcut, such as Shift+1.');
  const aliases = { CONTROL: 'CTRL', WINDOWS: 'WIN', META: 'WIN' };
  const parts = text.toUpperCase().split('+').map(s => aliases[s.trim()] || s.trim());
  if (parts.length && parts.every(p => modifiers[p])) {
    if (new Set(parts).size !== parts.length) throw new Error(`Duplicate modifier: ${text}`);
    // A zero keyboard usage leaves only the modifier bitmask in the HID report.
    return { hid: 0, modifiers: parts.reduce((mask, p) => mask | modifiers[p][0], 0), virtualKeys: parts.map(p => modifiers[p][1]) };
  }
  const key = keys[parts.pop()];
  if (!key || parts.some(p => !modifiers[p]) || new Set(parts).size !== parts.length) throw new Error(`Unsupported shortcut: ${text}`);
  return { hid: key[0], modifiers: parts.reduce((sum, p) => sum | modifiers[p][0], 0), virtualKeys: [...parts.map(p => modifiers[p][1]), key[1]] };
}
module.exports = { parseChord };
