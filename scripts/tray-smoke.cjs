// Run with: node_modules/electron/dist/electron.exe scripts/tray-smoke.cjs
const { app, Tray, Menu, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trayPixels, trayState, trayImage } = require('../app/tray.cjs');
const { BatteryMonitor } = require('../app/battery.cjs');
app.whenReady().then(() => {
  let tray;
  try {
    const output = path.join(__dirname, '../artifacts/tray-smoke');
    fs.mkdirSync(output, { recursive: true });
    const monitor = new BatteryMonitor(null), device = { id: 'smoke', productId: 0x0090, name: 'Naga Pro' };
    const samples = [[null, false], [0, false], [1, false], [20, false], [75, false], [99, false], [100, false], [100, true]];
    const preview = Buffer.alloc(samples.length * 32 * 32 * 4);
    samples.forEach(([level, charging], n) => {
      const pixels = trayPixels(level, charging);
      const icon = trayImage(nativeImage, level, charging);
      assert.equal(icon.isEmpty(), false);
      assert.deepEqual(icon.getScaleFactors(),[1,1.25,1.5,2,2.5,3,4]);
      for (const size of [16,20,24,32,40,48,64]) {
        const options={scaleFactor:size/16};
        assert.deepEqual(icon.toBitmap(options),trayPixels(level,charging,size));
        fs.writeFileSync(path.join(output, `${level ?? 'unavailable'}${charging ? '-charging' : ''}-${size}px.png`),icon.toPNG(options));
      }
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
    const sizes=[16,20,24,32], width=samples.length*44, height=112, actual=Buffer.alloc(width*height*4);
    for(let i=0;i<actual.length;i+=4)actual.set([32,32,32,255],i);
    let top=0;
    for(const size of sizes) {
      samples.forEach(([level,charging],n)=>{
        const pixels=trayPixels(level,charging,size);
        for(let y=0;y<size;y++)pixels.copy(actual,((top+y)*width+n*44)*4,y*size*4,(y+1)*size*4);
      });
      top+=size+4;
    }
    fs.writeFileSync(path.join(output,'actual-sizes.png'),nativeImage.createFromBitmap(actual,{width,height}).toPNG());
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,sizes:[16,20,24,32,40,48,64],samples},null,2));
    console.log('Tray smoke passed at native 16–64px sizes.');
  } finally { tray?.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
