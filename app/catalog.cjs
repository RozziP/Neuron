// USB product IDs: OpenRazer driver/razermouse_driver.h (see docs/hardware.md).
const { mappingDrivers } = require('./drivers.cjs');
const {devices,layoutFor,controlsFor,sideLabels} = require('./razer-layouts.cjs');
const catalog = devices.map(({productId,name,bluetooth,batteryExpected}) => ({productId,name,bluetooth,batteryExpected,buttons:layoutFor(productId).side,
  vendorId:0x1532, brand:'Razer',
  driver:mappingDrivers.get(productId)?.id || null, mappingPlates:mappingDrivers.get(productId)?.plates || [],
  physicalPlates:layoutFor(productId).plates, controls:controlsFor(productId),
  sideLabels:Object.fromEntries(layoutFor(productId).plates.map(n=>[n,sideLabels(n)])),
  topControls:controlsFor(productId).filter(c=>c.editable).map(c=>c.id),
  driverValidation:bluetooth?'unavailable':mappingDrivers.get(productId)?.validation,
  topLabels:mappingDrivers.get(productId)?.topLabels || {} }));
catalog.push({productId:0xf55d, vendorId:0x3554, brand:'Redragon', name:'M990-WL', buttons:16,
  driver:'redragon-m990-wl-experimental', mappingPlates:[16], physicalPlates:[16], controls:[], topControls:[], topLabels:{},
  sideLabels:{16:Array.from({length:16},(_,i)=>String(i+1))}, driverValidation:'locally-tested'});
module.exports = { catalog };
