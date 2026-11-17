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
  return report.subarray(8, 88);
}
function bindingPacket(slot, source, action) { return packet(0x0c, [slot, source, 0, action.type, action.params.length, ...action.params]); }
function bindingFromReply(args, slot, source) {
  if (args[0] !== slot || args[1] !== source || args[4] > 5) throw new Error('Unexpected button mapping response.');
  return { type: args[3], params: [...args.subarray(5, 5 + args[4])] };
}
module.exports = { checksum, packet, decode, bindingPacket, bindingFromReply };
