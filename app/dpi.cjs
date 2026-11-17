const { packet } = require('./protocol.cjs');
const MIN_DPI = 100, MAX_DPI = 16000;
function validateDpi(dpi) {
  if (!dpi || typeof dpi !== 'object' || Array.isArray(dpi) ||
      ![dpi.x, dpi.y].every(value => Number.isInteger(value) && value >= MIN_DPI && value <= MAX_DPI))
    throw new Error('DPI must be a whole number from 100 to 16,000 for each axis.');
  return { x: dpi.x, y: dpi.y };
}
// Trinity current sensitivity: class 04, GET 85 / SET 05, big-endian XY.
// Use the runtime store; the onboard DPI-stage table is not rewritten.
function dpiPacket(dpi) {
  if (dpi === undefined) return packet(0x85, [0], 4, 7);
  const { x, y } = validateDpi(dpi);
  return packet(0x05, [0, x >> 8, x & 255, y >> 8, y & 255, 0, 0], 4, 7);
}
function dpiFromReply(args) {
  if (args.length < 7 || args[0] !== 0) throw new Error('Unexpected DPI response.');
  return validateDpi({ x: (args[1] << 8) | args[2], y: (args[3] << 8) | args[4] });
}
const sameDpi = (a, b) => a.x === b.x && a.y === b.y;
module.exports = { MIN_DPI, MAX_DPI, validateDpi, dpiPacket, dpiFromReply, sameDpi };
