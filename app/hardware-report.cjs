const { catalog } = require('./catalog.cjs');
const hex = value => value.toString(16).padStart(4, '0');
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const clean = value => typeof value === 'string' ? value.replace(/[^\p{L}\p{N} ._()+/-]/gu, '').trim().slice(0, 100) : '';
const modelFor = (vendorId, productId) => vendorId === 0x1532 ? catalog.find(m => m.productId === productId) : null;
const hasSupportedDriver = model => !!model?.driver && model.driverValidation !== 'best-guess';
const reportKey = report => `${hex(report.vendorId)}:${hex(report.productId)}`;
function normalizeConfirmation(input) {
  if (!input || input.version !== 1 || !integer(input.vendorId,1,65535) || !integer(input.productId,1,65535) ||
      typeof input.modelName !== 'string' || input.modelName.length > 100 || !clean(input.modelName)) throw new Error('Enter a mouse brand and model (up to 100 characters).');
  return {version:1,vendorId:input.vendorId,productId:input.productId,modelName:clean(input.modelName)};
}
function supportedConfirmation(input) {
  const confirmation = normalizeConfirmation(input), model = modelFor(confirmation.vendorId,confirmation.productId);
  const name = confirmation.modelName.toLowerCase().replace(/^razer\s+/, '').replace(/\s+/g,' ');
  return hasSupportedDriver(model) && name === clean(model.name).toLowerCase().replace(/\s+/g,' ') ? model : null;
}
const unique = (items, limit) => [...new Map(items.map(item => [JSON.stringify(item), item])).values()]
  .sort((a,b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0).slice(0, limit);
const capabilityFields = ['inputReportBytes', 'outputReportBytes', 'featureReportBytes', 'linkCollections',
  'inputButtonCaps', 'inputValueCaps', 'outputButtonCaps', 'outputValueCaps', 'featureButtonCaps', 'featureValueCaps'];
function capabilities(input) {
  if (!input || !capabilityFields.every(key => integer(input[key], 0, 65535))) return null;
  return Object.fromEntries(capabilityFields.map(key => [key, input[key]]));
}
function identification(input, model, vendorId, productId) {
  const evidence = input && typeof input === 'object' ? input : {};
  const windows = unique((Array.isArray(evidence.windows) ? evidence.windows : []).slice(0,32).map(d => ({
    deviceClass: clean(d?.deviceClass), description: clean(d?.description), busDescription: clean(d?.busDescription),
    manufacturer: clean(d?.manufacturer), driverProvider: clean(d?.driverProvider), driverVersion: clean(d?.driverVersion)
  })), 16);
  const software = unique((Array.isArray(evidence.software) ? evidence.software : []).slice(0,8)
    .filter(d => d?.source === 'installed-driver-config' && d.vendorId === vendorId && d.productId === productId)
    .map(d => ({source: 'installed-driver-config', name: clean(d.name), version: clean(d.version),
      vendorId, productId, configuredModelId: integer(d.configuredModelId,0,65535) ? d.configuredModelId : null})), 8);
  return {
    status: model ? 'catalog-match' : 'unconfirmed',
    limitation: 'USB IDs may be shared. Installed software is a candidate, not proof of the paired mouse model. No device-specific identity or firmware query was sent.',
    windowsStatus: ['complete','partial','unavailable','not-collected'].includes(evidence.windowsStatus) ? evidence.windowsStatus : 'not-collected',
    softwareStatus: ['complete','unavailable','not-supported','not-collected'].includes(evidence.softwareStatus) ? evidence.softwareStatus : 'not-collected',
    windows, software,
    ...(typeof evidence.confirmedModel === 'string' && clean(evidence.confirmedModel) ? {confirmedModel:clean(evidence.confirmedModel),confirmationSource:'user'} : {})
  };
}

// An allowlist is used on both sides of the network boundary. Never spread raw HID records.
function normalizeReport(input) {
  if (!input || ![1,2].includes(input.version) || !integer(input.vendorId, 1, 65535) || !integer(input.productId, 1, 65535)) throw new Error('Invalid hardware IDs.');
  const model = modelFor(input.vendorId, input.productId);
  if (hasSupportedDriver(model)) throw new Error('This model already has a driver.');
  if (!Array.isArray(input.interfaces) || !input.interfaces.length || input.interfaces.length > 32) throw new Error('Invalid interfaces.');
  const interfaces = input.interfaces.map(item => {
    if (!item || !integer(item.interface, -1, 255) || !integer(item.usagePage, 0, 65535) || !integer(item.usage, 0, 65535)) throw new Error('Invalid HID interface.');
    return { interface: item.interface, usagePage: item.usagePage, usage: item.usage,
      ...(input.version === 2 ? { product: clean(item.product), manufacturer: clean(item.manufacturer),
        release: integer(item.release,0,65535) ? item.release : null,
        capabilities: capabilities(item.capabilities),
        capabilitiesStatus: capabilities(item.capabilities) ? 'complete' : item.capabilitiesStatus === 'unavailable' ? 'unavailable' : 'not-collected' } : {}) };
  });
  if (!model && !interfaces.some(i => i.usagePage === 1 && i.usage === 2)) throw new Error('Not a mouse.');
  const result = {
    version: input.version, vendorId: input.vendorId, productId: input.productId,
    model: model?.name || clean(input.model) || 'Unknown mouse', manufacturer: clean(input.manufacturer),
    release: integer(input.release, 0, 65535) ? input.release : null,
    interfaces: unique(interfaces,32).sort((a,b) => a.interface-b.interface || a.usagePage-b.usagePage || a.usage-b.usage),
    ...(input.version === 2 ? { identification: identification(input.identification, model, input.vendorId, input.productId) } : {}),
    appVersion: clean(input.appVersion), platform: clean(input.platform), osVersion: clean(input.osVersion), architecture: clean(input.architecture)
  };
  if(input.version===2) {
    if(input.truncated===true)result.truncated=true;
    // Keep the normalized envelope below the service's 32 KiB transport limit,
    // including multibyte labels. Preserve a mouse collection when trimming.
    while(new TextEncoder().encode(JSON.stringify(result)).length>30000) {
      result.truncated=true;
      if(result.identification.windows.length)result.identification.windows.pop();
      else if(result.identification.software.length>1)result.identification.software.pop();
      else {
        const index=result.interfaces.findLastIndex(i=>i.usagePage!==1||i.usage!==2);
        if(index>=0)result.interfaces.splice(index,1);
        else if(result.interfaces.length>1)result.interfaces.pop();
        else break;
      }
    }
  }
  return result;
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
    const labels = unique(group.map(d => ({product:clean(d.product),manufacturer:clean(d.manufacturer),release:integer(d.release,0,65535)?d.release:null})),32);
    const d = {...group[0], ...labels[0]}, model = modelFor(d.vendorId, d.productId);
    if (hasSupportedDriver(model) || (!model && !group.some(i => i.usagePage === 1 && i.usage === 2))) continue;
    try {
      reports.push(normalizeReport({ ...system, version: 2, vendorId: d.vendorId, productId: d.productId,
        model: d.product, manufacturer: d.manufacturer, release: d.release,
        interfaces: unique(group.map(i => ({ interface: integer(i.interface,-1,255) ? i.interface : -1, usagePage: i.usagePage ?? 0, usage: i.usage ?? 0,
          product: clean(i.product), manufacturer: clean(i.manufacturer), release: integer(i.release,0,65535) ? i.release : null })),32) }));
    } catch { /* Incomplete enumeration is not evidence of an unsupported mouse. */ }
  }
  return reports;
}
async function reportFingerprint(input) {
  const { appVersion, platform, osVersion, architecture, ...evidence } = normalizeReport(input);
  const bytes = new TextEncoder().encode(JSON.stringify(evidence));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
}
module.exports = { collectReports, normalizeReport, reportKey, reportFingerprint, cleanLabel: clean, normalizeConfirmation, supportedConfirmation };
