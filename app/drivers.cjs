// Independently implemented from the captures linked in docs/hardware.md.
// Transport IDs and mouse models remain separate, especially behind shared docks.
const {devices:razerDevices,layoutFor,sideIds,controlsFor} = require('./razer-layouts.cjs');
const establishedIds = new Map([[0x0067,'trinity'],[0x008f,'naga-pro'],[0x0090,'naga-pro'],
  [0x00a7,'naga-v2-pro'],[0x00a8,'naga-v2-pro'],[0x00b4,'naga-v2-hyperspeed'],[0x00e7,'naga-v3-pro'],[0x00e8,'naga-v3-pro']]);
const mappingDrivers = new Map(razerDevices.filter(d=>!d.bluetooth).map(d=>[d.productId,{
  id:`${establishedIds.get(d.productId)||'razer-'+d.productId.toString(16)}-experimental`,
  slots:[0],readSlot:0,raw:true,requestSize:10,...layoutFor(d.productId),
  topLabels:layoutFor(d.productId).labels||{},model:d.productId
}]));
const dockModels = [0x00a7,0x00a8,0x00e7,0x00e8,0x00aa,0x00ab,0x00af,0x00b0,0x00cc,0x00cd,0x00d6,0x00d7];
function driverFor(device) {
  const redragon = require('./redragon.cjs');
  if (device.vendorId === 0x3554) return [0xf55d,0xf55e].includes(device.productId) && device.modelId === redragon.MODEL && device.modelVerified ? redragon.DRIVER : null;
  if (device.vendorId !== undefined && device.vendorId !== 0x1532) return null;
  if (device.productId === 0x00a4) {
    // A user choice is required: this dock also pairs with non-Naga mice.
    return dockModels.includes(device.modelId) ? mappingDrivers.get(device.modelId) : null;
  }
  return mappingDrivers.get(device.productId) || null;
}
function sideSources(driver, plate) {
  return sideIds(driver,plate);
}
function mappingCapabilities(device) {
  const driver = driverFor(device);
  if (driver?.id === 'redragon-m990-wl-experimental') return {driver:driver.id, mappingPlates:[16], controls:[], driverValidation:driver.validation, support:'experimental', supportMessage:'Experimental M990-WL side-button remapping and active-stage DPI. Originals are backed up and writes are verified. Close the Redragon configuration software before applying. Top controls are not supported yet.'};
  return driver ? {driver:driver.id, mappingPlates:driver.plates, driverValidation:driver.validation,
    controls:controlsFor(device.modelId??device.productId),
    support:'experimental', supportMessage:driver.validation==='best-guess'
      ? 'Best-guess driver and button layout based on related Razer models. Not hardware verified. Unreadable assignments stop the apply before any writes; originals are backed up and writes are read back. Close Synapse before applying.'
      : driver.validation==='locally-tested' ? undefined : 'Experimental remapping from community protocol evidence. Not physically verified in Neuron. Originals are backed up and writes are read back. Close Synapse before applying.'} : {};
}
function pairedMouse(args) {
  const count = args[0];
  if (!Number.isInteger(count) || count > 26 || args.length < 1 + count * 3) throw new Error('Invalid paired-mouse response.');
  const connected = [];
  for (let i=0; i<count; i++) {
    const offset = 1+i*3, pid = (args[offset+1]<<8) | args[offset+2];
    if (args[offset] === 1 && pid !== 0 && pid !== 65535) connected.push(pid);
  }
  return connected.length === 1 ? connected[0] : null;
}
module.exports = { mappingDrivers, driverFor, sideSources, mappingCapabilities, pairedMouse, dockModels };
