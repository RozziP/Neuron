const { hasBattery } = require('./battery.cjs');
// Nine-pixel numerals stay legible in a 16px notification-area icon.
// The narrow 1 lets 100 fit without reducing the height of the other digits.
const digits = [
  ['01110','10001','10001','10001','10001','10001','10001','10001','01110'],
  ['010','110','010','010','010','010','010','010','111'],
  ['01110','10001','00001','00001','00110','01000','10000','10000','11111'],
  ['11110','00001','00001','00001','01110','00001','00001','00001','11110'],
  ['10001','10001','10001','10001','11111','00001','00001','00001','00001'],
  ['11111','10000','10000','10000','11110','00001','00001','00001','11110'],
  ['01110','10000','10000','10000','11110','10001','10001','10001','01110'],
  ['11111','00001','00001','00010','00100','00100','01000','01000','01000'],
  ['01110','10001','10001','10001','01110','10001','10001','10001','01110'],
  ['01110','10001','10001','10001','01111','00001','00001','00001','01110']
];
function trayState(devices, monitor, activeId) {
  const wireless = devices.filter(d => d.support !== 'recognition-only' && hasBattery(d));
  const selected = wireless.find(d => d.id === activeId) || wireless[0];
  const battery = selected && monitor.cache.get(selected.id);
  const lines = devices.map(d => `${d.name}: ${monitor.status(d)}`);
  return { level: battery?.level ?? null, charging: battery?.charging === true,
    tooltip: ['Neuron', ...lines.length ? lines : ['No mouse or receiver detected']].join('\n'), lines };
}
function trayPixels(level, charging = false, size = 32) {
  if (!Number.isInteger(size) || size < 16 || size > 64) throw new Error('Invalid tray icon size.');
  const pixels = Buffer.alloc(size * size * 4);
  const valid = Number.isInteger(level) && level >= 0 && level <= 100;
  // Native Windows bitmap pixels are BGRA. Snap each shape to physical pixels
  // at every scale instead of asking Windows to shrink a single 32px bitmap.
  const color = charging ? [255, 205, 100] : level <= 20 ? [100, 135, 255] : [180, 235, 124];
  function dot(x, y, ink) {
    for (let py = Math.round(y * size / 16); py < Math.round((y + 1) * size / 16); py++)
      for (let px = Math.round(x * size / 16); px < Math.round((x + 1) * size / 16); px++) {
      const i = (py * size + px) * 4;
      pixels.set([...ink, 255], i);
    }
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dot(x, y, [21, 16, 13]);
  if (!valid) {
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++)
      if (x <= 4 || x >= 11 || Math.abs(y - x) <= 1) dot(x, y, [180, 235, 124]);
    return pixels;
  }
  const glyphs = [...String(level)].map(n => digits[Number(n)]);
  const width = glyphs.reduce((sum, glyph) => sum + glyph[0].length, 0) + glyphs.length - 1;
  let left = Math.floor((16 - width) / 2);
  for (const glyph of glyphs) {
    for (let y = 0; y < 9; y++) for (let x = 0; x < glyph[0].length; x++)
      if (glyph[y][x] === '1') dot(left + x, y + 1, [255, 255, 255]);
    left += glyph[0].length + 1;
  }
  // A solid three-pixel bar keeps the remaining capacity visibly separate.
  // Leave at least one empty pixel below 100%; 0% has no colored fill.
  const fill = level === 100 ? 13 : level === 0 ? 0 : Math.max(1, Math.min(12, Math.round(level * 13 / 100)));
  for (let y = 12; y <= 14; y++) for (let x = 1; x <= 13; x++) dot(x, y, x <= fill ? color : [90, 85, 82]);
  dot(14, 13, [160, 155, 152]);
  return pixels;
}
function trayImage(nativeImage, level, charging = false) {
  const image = nativeImage.createEmpty();
  for (const size of [16, 20, 24, 32, 40, 48, 64])
    image.addRepresentation({ width:size, height:size, scaleFactor:size/16, buffer:trayPixels(level, charging, size) });
  return image;
}
module.exports = { trayState, trayPixels, trayImage };
