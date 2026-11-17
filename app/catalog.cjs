// USB product IDs: OpenRazer driver/razermouse_driver.h (see docs/hardware.md).
const catalog = [
  [0x0015, 'Naga', 12], [0x001f, 'Naga Epic', 12], [0x002e, 'Naga 2012', 12],
  [0x0036, 'Naga Hex Red', 6], [0x003e, 'Naga Epic Chroma', 12], [0x0040, 'Naga 2014', 12],
  [0x0041, 'Naga Hex', 6], [0x0050, 'Naga Hex V2', 7], [0x0053, 'Naga Chroma', 12],
  [0x0067, 'Naga Trinity', 12], [0x008d, 'Naga Left-Handed 2020', 12],
  [0x008f, 'Naga Pro · wired', 12], [0x0090, 'Naga Pro · receiver', 12], [0x0096, 'Naga X', 12],
  [0x00a7, 'Naga V2 Pro · wired', 12], [0x00a8, 'Naga V2 Pro · receiver', 12],
  [0x00b4, 'Naga V2 HyperSpeed', 12]
].map(([productId, name, buttons]) => ({ productId, name, buttons, driver: productId === 0x0067 ? 'trinity-experimental' : null }));
module.exports = { catalog };
