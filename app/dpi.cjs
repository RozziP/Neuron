const { packet } = require('./protocol.cjs');
const MIN_DPI = 100, MAX_DPI = 16000;
function dpiCapabilities(device) {
  if (!device || (device.vendorId !== undefined && device.vendorId !== 0x1532)) return null;
  if (device.productId === 0x0067 && !device.connection) return { min: MIN_DPI, max: MAX_DPI };
  if ([0x00a7,0x00a8].includes(device.productId) ||
      (device.productId === 0x00a4 && [0x00a7,0x00a8].includes(device.modelId))) return { min: MIN_DPI, max: 30000 };
  return null;
}
function validateDpi(dpi, limits = { min: MIN_DPI, max: MAX_DPI }) {
  if (!limits) throw new Error('DPI control is unavailable for this mouse connection.');
  if (!dpi || typeof dpi !== 'object' || Array.isArray(dpi) ||
      ![dpi.x, dpi.y].every(value => Number.isInteger(value) && value >= limits.min && value <= limits.max))
    throw new Error(`DPI must be a whole number from ${limits.min.toLocaleString('en-US')} to ${limits.max.toLocaleString('en-US')} for each axis.`);
  return { x: dpi.x, y: dpi.y };
}
// Trinity and V2 Pro current sensitivity: class 04, GET 85 / SET 05, big-endian XY.
// Use the runtime store; the onboard DPI-stage table is not rewritten.
function dpiPacket(dpi, limits) {
  if (dpi === undefined) return packet(0x85, [0], 4, 7);
  const { x, y } = validateDpi(dpi, limits);
  return packet(0x05, [0, x >> 8, x & 255, y >> 8, y & 255, 0, 0], 4, 7);
}
function dpiFromReply(args, limits) {
  if (args.length < 7 || args[0] !== 0) throw new Error('Unexpected DPI response.');
  return validateDpi({ x: (args[1] << 8) | args[2], y: (args[3] << 8) | args[4] }, limits);
}
const sameDpi = (a, b) => a.x === b.x && a.y === b.y;
module.exports = { MIN_DPI, MAX_DPI, dpiCapabilities, validateDpi, dpiPacket, dpiFromReply, sameDpi };
