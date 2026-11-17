function checksum(report) { let sum = 0; for (let i = 2; i < 88; i++) sum ^= report[i]; return sum; }
function packet(command, args = [], commandClass = 2, size = 10, transaction = 0x1f) {
  if (args.length > 80 || size > 80 || size < args.length) throw new Error('Invalid report payload.');
  const report = Buffer.alloc(90);
  report[1] = transaction; report[5] = size; report[6] = commandClass; report[7] = command;
  report.set(args, 8); report[88] = checksum(report); return report;
}
function decode(raw, request) {
  const report = Buffer.from(raw);
  if (report.length !== 90 || report[88] !== checksum(report)) throw new Error('Invalid HID response checksum or length.');
  if (report[6] !== request[6] || report[7] !== request[7] || report[1] !== request[1]) throw new Error('Unrelated HID response. Close Synapse and retry.');
  if (report[0] !== 2) throw new Error(`Mouse rejected command (status ${report[0]}).`);
  if (report[5] > 80) throw new Error('Invalid HID response payload length.');
  if (request[6] === 0x07 && [0x80, 0x84].includes(request[7]) && report[5] < 2) throw new Error('Incomplete battery response.');
  if (request[6] === 2 && request[7] === 0x8c && report[5] < 10) throw new Error('Incomplete button mapping response.');
  if (request[6] === 0 && request[7] === 0xbf && (report[8] > 26 || report[5] < 1 + report[8] * 3)) throw new Error('Incomplete paired-mouse response.');
  return report.subarray(8, 88);
}
function functionBlock(action) {
  if (action.raw) {
    if (!Array.isArray(action.raw) || action.raw.length !== 7 || action.raw.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid saved function block.');
    return action.raw;
  }
  return [action.type, action.params.length, ...action.params, ...Array(5-action.params.length).fill(0)];
}
function bindingPacket(slot, source, action) { return packet(0x0c, [slot, source, 0, ...functionBlock(action)]); }
function bindingFromReply(args, slot, source, preserveRaw = false) {
  if (args.length < 10) throw new Error('Incomplete button mapping response.');
  if (args[0] !== slot || args[1] !== source || args[4] > 5) throw new Error('Unexpected button mapping response.');
  // Native length-1 keyboard blocks still contain the key in the SECOND data
  // byte. Preserve all seven function bytes, including unknown actions. Byte 2
  // in a reply is not a reliable layer echo; normal-layer restores always use 0.
  return { type: args[3], params: [...args.subarray(5, 5 + args[4])],
    ...(preserveRaw ? {raw:[...args.subarray(3,10)]} : {}) };
}
module.exports = { checksum, packet, decode, bindingPacket, bindingFromReply, functionBlock };
