// This USB identity is shared by multiple mouse models. It is deliberately
// excluded from the profile catalog until a model-specific driver is verified.
const compxReceiver = {
  vendorId: 0x3554, productId: 0xf55d,
  name: 'Compx 2.4G Wireless Receiver',
  connection: 'receiver', support: 'recognition-only', driver: null,
  supportMessage: 'Receiver detected. The mouse model is unknown. Button mapping, DPI, macros, and battery readings are not supported for this receiver yet.'
};
const mouseDockPro = {
  vendorId: 0x1532, productId: 0x00a4,
  name: 'Razer Mouse Dock Pro',
  connection: 'dock', support: 'recognition-only', driver: null,
  supportMessage: 'Which mouse is paired with this Mouse Dock Pro? Select its model below to choose a driver. Experimental remapping is available for Naga V2 Pro and V3 Pro; other docked models are not supported.'
};

function discoverReceivers(records) {
  const devices = new Map();
  for (const d of records) {
    const receiver = [compxReceiver, mouseDockPro].find(r => r.vendorId === d.vendorId && r.productId === d.productId);
    if (!receiver || d.interface !== (receiver.connection === 'dock' ? 0 : 2) ||
        d.usagePage !== 1 || d.usage !== 2 || !d.path) continue;
    // Anchor recognition to the mouse collection. The seven keyboard, consumer,
    // and vendor collections are not separate mice or known control endpoints.
    const id = `${d.vendorId}:${d.productId}:${d.path}`;
    devices.set(id, { ...receiver, id, connected: true,
      paths: [{ path: d.path, interface: d.interface, usagePage: d.usagePage, usage: d.usage }] });
  }
  return [...devices.values()];
}

module.exports = { discoverReceivers };
