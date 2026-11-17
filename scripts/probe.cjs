// Read-only queries; never sends a mapping SET command.
const hid = require('node-hid');
const { Bridge } = require('../app/bridge.cjs');
const { packet, decode, bindingFromReply } = require('../app/protocol.cjs');
(async () => {
  const bridge = new Bridge();
  try {
    for (const device of hid.devices().filter(d => d.vendorId === 0x1532 && d.productId === 0x0067)) {
      try {
        const request = packet(0x8c, [1, 0x40]);
        const result = await bridge.call('exchange', { path: device.path, report: request.toString('base64') });
        const raw = Buffer.from(result.report, 'base64');
        const args = decode(raw, request);
        console.log(JSON.stringify({ interface: device.interface, usage: device.usage, binding: bindingFromReply(args, 1, 0x40), path: device.path }));
      } catch(error) { console.log(JSON.stringify({ interface: device.interface, usage: device.usage, error: error.message })); }
    }
  } finally { bridge.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
