// Independently implemented from the captures linked in docs/hardware.md.
// Transport IDs and mouse models remain separate, especially behind shared docks.
const commonTop = {left:1, right:2, middle:3, 'wheel-up':9, 'wheel-down':10, 'tilt-left':52, 'tilt-right':53};
const trinity = {id:'trinity-experimental', plates:[7,12], slots:[2,1], readSlot:1,
  top:{...commonTop, 'dpi-up':11, 'dpi-down':12}, raw:false, validation:'locally-tested'};
const pro = {id:'naga-pro-experimental', plates:[2,6,12], slots:[0], readSlot:0,
  top:{...commonTop, 'dpi-up':12, 'dpi-down':11}, raw:true, validation:'community-protocol'};
const v2 = {...pro, id:'naga-v2-pro-experimental', top:{...commonTop, 'dpi-up':109, 'dpi-down':96},
  topLabels:{'dpi-up':'Front wheel-stage button', 'dpi-down':'Rear wheel-stage button'}};
const v3 = {...pro, id:'naga-v3-pro-experimental'};
const hyperspeed = {...pro, id:'naga-v2-hyperspeed-experimental', plates:[12], slots:[1,0],
  top:{...commonTop, 'dpi-up':11, 'dpi-down':12}};
const mappingDrivers = new Map([[0x0067,trinity], [0x008f,pro], [0x0090,pro],
  [0x00a7,v2], [0x00a8,v2], [0x00b4,hyperspeed], [0x00e7,v3], [0x00e8,v3]]);
function driverFor(device) {
  if (device.vendorId !== undefined && device.vendorId !== 0x1532) return null;
  if (device.productId === 0x00a4) {
    // A user choice is required: this dock also pairs with non-Naga mice.
    return [0x00a7,0x00a8,0x00e7,0x00e8].includes(device.modelId) ? mappingDrivers.get(device.modelId) : null;
  }
  return mappingDrivers.get(device.productId) || null;
}
function sideSources(driver, plate) {
  if (!driver || !driver.plates.includes(plate)) throw new Error('This driver does not support the selected side plate.');
  if (plate === 2) return [5,4]; // Front / rear, not printed numbers.
  return Array.from({length:plate}, (_,i) => (plate === 12 ? 0x40 : 0x50) + i);
}
function mappingCapabilities(device) {
  const driver = driverFor(device);
  return driver ? {driver:driver.id, mappingPlates:driver.plates, driverValidation:driver.validation,
    support:'experimental', supportMessage:driver.raw
      ? 'Experimental remapping from published hardware captures. Not yet physically verified in Neuron. Original assignments are backed up and every write is read back. Close Synapse before applying.'
      : undefined} : {};
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
module.exports = { mappingDrivers, driverFor, sideSources, mappingCapabilities, pairedMouse };
