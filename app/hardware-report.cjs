const { catalog } = require('./catalog.cjs');
const hex = value => value.toString(16).padStart(4, '0');
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const clean = value => typeof value === 'string' ? value.replace(/[^\p{L}\p{N} ._()+/-]/gu, '').trim().slice(0, 100) : '';
const modelFor = (vendorId, productId) => vendorId === 0x1532 ? catalog.find(m => m.productId === productId) : null;
const reportKey = report => `${hex(report.vendorId)}:${hex(report.productId)}`;

// An allowlist is used on both sides of the network boundary. Never spread raw HID records.
function normalizeReport(input) {
  if (!input || input.version !== 1 || !integer(input.vendorId, 1, 65535) || !integer(input.productId, 1, 65535)) throw new Error('Invalid hardware IDs.');
  const model = modelFor(input.vendorId, input.productId);
  if (model?.driver) throw new Error('This model already has a driver.');
  if (!Array.isArray(input.interfaces) || !input.interfaces.length || input.interfaces.length > 32) throw new Error('Invalid interfaces.');
  const interfaces = input.interfaces.map(item => {
    if (!item || !integer(item.interface, -1, 255) || !integer(item.usagePage, 0, 65535) || !integer(item.usage, 0, 65535)) throw new Error('Invalid HID interface.');
    return { interface: item.interface, usagePage: item.usagePage, usage: item.usage };
  });
  if (!model && !interfaces.some(i => i.usagePage === 1 && i.usage === 2)) throw new Error('Not a mouse.');
  return {
    version: 1, vendorId: input.vendorId, productId: input.productId,
    model: model?.name || clean(input.model) || 'Unknown mouse', manufacturer: clean(input.manufacturer),
    release: integer(input.release, 0, 65535) ? input.release : null,
    interfaces: [...new Map(interfaces.map(i => [JSON.stringify(i), i])).values()].sort((a,b) => a.interface-b.interface || a.usagePage-b.usagePage || a.usage-b.usage),
    appVersion: clean(input.appVersion), platform: clean(input.platform), osVersion: clean(input.osVersion), architecture: clean(input.architecture)
  };
}

function collectReports(records, system) {
  const groups = new Map();
  for (const d of records) {
    if (!integer(d.vendorId, 1, 65535) || !integer(d.productId, 1, 65535)) continue;
    const key = reportKey(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const reports = [];
  for (const group of groups.values()) {
    const d = group[0], model = modelFor(d.vendorId, d.productId);
    if (model?.driver || (!model && !group.some(i => i.usagePage === 1 && i.usage === 2))) continue;
    try {
      reports.push(normalizeReport({ ...system, version: 1, vendorId: d.vendorId, productId: d.productId,
        model: d.product, manufacturer: d.manufacturer, release: d.release,
        interfaces: group.map(i => ({ interface: integer(i.interface,-1,255) ? i.interface : -1, usagePage: i.usagePage ?? 0, usage: i.usage ?? 0 })).slice(0,32) }));
    } catch { /* Incomplete enumeration is not evidence of an unsupported mouse. */ }
  }
  return reports;
}
module.exports = { collectReports, normalizeReport, reportKey };
