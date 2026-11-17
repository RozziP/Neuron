const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { normalizeReport, reportKey, cleanLabel } = require('./hardware-report.cjs');
const exec = promisify(execFile);

class HardwareEvidence {
  constructor(bridge, { run = exec, platform = process.platform, now = Date.now } = {}) {
    this.bridge = bridge; this.run = run; this.platform = platform; this.now = now; this.cache = new Map();
  }
  async enrich(report, records) {
    const matching = records.filter(d => d.vendorId === report.vendorId && d.productId === report.productId);
    const key = reportKey(report);
    // Paths remain local; they invalidate cached evidence on device replacement.
    const signature = JSON.stringify(matching.map(d => [d.path,d.release,d.product,d.manufacturer,d.interface,d.usagePage,d.usage]).sort());
    const previous = this.cache.get(key);
    if (previous?.signature === signature && previous.expires > this.now()) return normalizeReport({...report, ...previous.evidence});
    let identification = {windowsStatus:'unavailable', softwareStatus:'not-supported'};
    if (this.platform === 'win32') {
      try {
        const script = path.join(__dirname,'../scripts/hardware-evidence.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
        const {stdout} = await this.run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
          '-VendorId',String(report.vendorId),'-ProductId',String(report.productId)],{windowsHide:true,timeout:20000,maxBuffer:65536});
        identification = JSON.parse(stdout.replace(/^\uFEFF/,''));
      } catch { identification = {windowsStatus:'unavailable',softwareStatus:'unavailable'}; }
    }
    const interfaces = [], visited = new Set(), deadline = this.now() + 15000;
    for (const collection of report.interfaces) {
      const sources = matching.filter(d => (d.interface ?? -1) === collection.interface && (d.usagePage ?? 0) === collection.usagePage &&
        (d.usage ?? 0) === collection.usage && cleanLabel(d.product) === collection.product && cleanLabel(d.manufacturer) === collection.manufacturer && (d.release ?? null) === collection.release);
      for (const record of sources.length ? sources : [null]) {
        if (record?.path && visited.has(record.path)) continue;
        if (interfaces.length >= 32) break;
        if (record?.path) visited.add(record.path);
        let capabilities = null;
        if (this.platform === 'win32' && record?.path && this.bridge && this.now() < deadline) {
          try { capabilities = await this.bridge.call('hidCapabilities',{path:record.path}); }
          catch { /* Missing descriptor metadata must not suppress the base report. */ }
        }
        interfaces.push({...collection, capabilities, capabilitiesStatus: capabilities ? 'complete' : 'unavailable'});
      }
    }
    const enriched = normalizeReport({...report, interfaces, identification});
    const incomplete = enriched.identification.windowsStatus !== 'complete' || enriched.identification.softwareStatus === 'unavailable' || interfaces.some(i=>!i.capabilities);
    this.cache.set(key,{signature, expires:this.now() + (incomplete ? 60000 : 3600000), evidence:{interfaces:enriched.interfaces,identification:enriched.identification}});
    return enriched;
  }
}
module.exports = { HardwareEvidence };
