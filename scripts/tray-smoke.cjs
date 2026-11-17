// Run with: node_modules/electron/dist/electron.exe scripts/tray-smoke.cjs
const { app, Tray, Menu, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trayPixels, trayState } = require('../app/tray.cjs');
const { BatteryMonitor } = require('../app/battery.cjs');
app.whenReady().then(() => {
  let tray;
  try {
    const output = path.join(__dirname, '../artifacts/tray-smoke');
    fs.mkdirSync(output, { recursive: true });
    const monitor = new BatteryMonitor(null), device = { id: 'smoke', productId: 0x0090, name: 'Naga Pro' };
    const samples = [[null, false], [0, false], [20, false], [75, false], [100, true]];
    const preview = Buffer.alloc(samples.length * 32 * 32 * 4);
    samples.forEach(([level, charging], n) => {
      const pixels = trayPixels(level, charging);
      const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
      assert.equal(icon.isEmpty(), false);
      if (!tray) tray = new Tray(icon); else tray.setImage(icon);
      monitor.cache.set(device.id, { level, charging });
      const status = trayState([device], monitor);
      tray.setToolTip(status.tooltip);
      tray.setContextMenu(Menu.buildFromTemplate(status.lines.map(label => ({ label, enabled: false }))));
      assert.equal(tray.isDestroyed(), false);
      fs.writeFileSync(path.join(output, `${level ?? 'unavailable'}${charging ? '-charging' : ''}.png`), icon.toPNG());
      for (let y = 0; y < 32; y++) pixels.copy(preview, (y * samples.length * 32 + n * 32) * 4, y * 32 * 4, (y + 1) * 32 * 4);
    });
    fs.writeFileSync(path.join(output, 'preview.png'), nativeImage.createFromBitmap(preview, { width: samples.length * 32, height: 32 }).resize({ width: samples.length * 128, height: 128, quality: 'nearest' }).toPNG());
    console.log('Tray smoke passed: unavailable, 0%, low battery, 75%, and 100% charging.');
  } finally { tray?.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
