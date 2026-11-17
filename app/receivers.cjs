// This USB identity is shared by multiple mouse models. It is deliberately
// excluded from the profile catalog until a model-specific driver is verified.
const compxReceiver = {
  vendorId: 0x3554, productId: 0xf55d,
  name: 'Compx 2.4G Wireless Receiver',
  connection: 'receiver', support: 'recognition-only', driver: null,
  supportMessage: 'Receiver detected. The mouse model is unknown. Button mapping, DPI, macros, and battery readings are not supported for this receiver yet.'
};

function discoverReceivers(records) {
  const devices = new Map();
  for (const d of records) {
    if (d.vendorId !== compxReceiver.vendorId || d.productId !== compxReceiver.productId ||
        d.interface !== 2 || d.usagePage !== 1 || d.usage !== 2 || !d.path) continue;
    // Anchor recognition to the mouse collection. The seven keyboard, consumer,
    // and vendor collections are not separate mice or known control endpoints.
    const id = `${d.vendorId}:${d.productId}:${d.path}`;
    devices.set(id, { ...compxReceiver, id, connected: true,
      paths: [{ path: d.path, interface: d.interface, usagePage: d.usagePage, usage: d.usage }] });
  }
  return [...devices.values()];
}

module.exports = { discoverReceivers };
