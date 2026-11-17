const { hasBattery } = require('./battery.cjs');
const digits = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function trayState(devices, monitor, activeId) {
  const wireless = devices.filter(d => d.support !== 'recognition-only' && hasBattery(d));
  const selected = wireless.find(d => d.id === activeId) || wireless[0];
  const battery = selected && monitor.cache.get(selected.id);
  const lines = devices.map(d => `${d.name}: ${monitor.status(d)}`);
  return { level: battery?.level ?? null, charging: battery?.charging === true,
    tooltip: ['Neuron', ...lines.length ? lines : ['No mouse or receiver detected']].join('\n'), lines };
}
function trayPixels(level, charging = false) {
  const pixels = Buffer.alloc(32 * 32 * 4);
  const valid = Number.isInteger(level) && level >= 0 && level <= 100;
  // Native Windows bitmap pixels are BGRA. Draw on a 16px grid for tray readability.
  const color = charging ? [255, 205, 100] : level <= 20 ? [100, 135, 255] : [180, 235, 124];
  function dot(x, y, ink) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y * 2 + dy) * 32 + x * 2 + dx) * 4;
      pixels.set([...ink, 255], i);
    }
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dot(x, y, [21, 16, 13]);
  if (!valid) {
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++)
      if (x <= 4 || x >= 11 || Math.abs(y - x) <= 1) dot(x, y, [180, 235, 124]);
    return pixels;
  }
  const text = String(level), start = Math.floor((16 - (text.length * 4 - 1)) / 2);
  for (let n = 0; n < text.length; n++) for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++)
    if (digits[Number(text[n])][y * 3 + x] === '1') dot(start + n * 4 + x, y + 3, color);
  // Battery outline and proportional fill below the percentage digits.
  for (let y = 10; y <= 13; y++) for (let x = 1; x <= 13; x++)
    if (y === 10 || y === 13 || x === 1 || x === 13 || x <= 1 + Math.round(level * 11 / 100)) dot(x, y, color);
  dot(14, 11, color); dot(14, 12, color);
  return pixels;
}
module.exports = { trayState, trayPixels };
