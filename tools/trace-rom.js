const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const romPath = process.argv[2];
if (!romPath) throw new Error('Usage: node tools/trace-rom.js <rom.gb> [instruction-limit]');
const limit = Number(process.argv[3] || 1000000);
const root = path.join(__dirname, '..');
const context = vm.createContext({
  console: { log() {} },
  Uint8Array,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
});
vm.runInContext(fs.readFileSync(path.join(root, 'LR35902.js'), 'utf8'), context);
for (const file of ['GBmemorymapper.js', 'GBhardware.js', 'GBprocessor.js', 'main.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const ids = vm.runInContext('({ PC, SP, AF, BC, DE, HL })', context);
const rom = new Uint8Array(fs.readFileSync(romPath));
const info = context.loadRomBytes(rom);
if ((process.argv[3] || '').startsWith('frames:')) {
  const frames = Number(process.argv[3].slice(7));
  const frameVisits = new Map();
  const frameRecent = [];
  const entryTraces = [];
  const hramWrites = [];
  const scrollTrace = [];
  const tracedWriteMem = context.writeMem;
  context.writeMem = function(address, value) {
    if (address === 0xFF80 && hramWrites.length < 12) hramWrites.push([context.reg[ids.PC], value, context.activeRomBank]);
    return tracedWriteMem(address, value);
  };
  for (let opcode = 0; opcode < 256; opcode++) {
    const implementation = context.decode[opcode];
    context.decode[opcode] = function() {
      const pc = context.reg[ids.PC];
      if (pc === 0x185 && entryTraces.length < 5) entryTraces.push(frameRecent.slice(-12));
      frameVisits.set(pc, (frameVisits.get(pc) || 0) + 1);
      frameRecent.push(pc);
      if (frameRecent.length > 32) frameRecent.shift();
      return implementation();
    };
  }
  for (let frame = 0; frame < frames; frame++) {
    if ((process.argv[4] === 'start' || process.argv[4] === 'play') && frame === 30) context.setJoypadButton('start', true);
    if ((process.argv[4] === 'start' || process.argv[4] === 'play') && frame === 32) context.setJoypadButton('start', false);
    if (process.argv[4] === 'pokemon' && frame === 300) context.setJoypadButton('start', true);
    if (process.argv[4] === 'pokemon' && frame === 302) context.setJoypadButton('start', false);
    if (process.argv[4] === 'play' && frame === 90) context.setJoypadButton('right', true);
    if (process.argv[4] === 'play' && frame === frames - 1) context.setJoypadButton('right', false);
    context.runCpuFrame();
    if (process.argv[4] === 'play' && frame >= 85) scrollTrace.push(context.memory[0xFF43]);
  }
  const nonzeroVram = context.memory.subarray(0x8000, 0xa000).reduce((n, value) => n + (value !== 0), 0);
  console.log(`${info.title}, ${rom.length} bytes, type ${hex(info.cartridgeType, 2)}`);
  console.log(`after ${frames} frames: PC=${hex(context.reg[ids.PC], 4)} SP=${hex(context.reg[ids.SP], 4)} BC=${hex(context.reg[ids.BC], 4)} HL=${hex(context.reg[ids.HL], 4)} VRAM bytes=${nonzeroVram}`);
  console.log(`HRAM: FF80=${hex(context.memory[0xFF80], 2)} FF81=${hex(context.memory[0xFF81], 2)} FFB3=${hex(context.memory[0xFFB3], 2)}`);
  console.log('FF80 writes:', hramWrites.map(([pc, value, bank]) => `${hex(pc, 4)}=${hex(value, 2)}(bank ${bank})`).join(' '));
  console.log('entry visits:', ['100', '150', '185', '1bf', '1c5', '1d4'].map(value => `0x${value}=${frameVisits.get(parseInt(value, 16)) || 0}`).join(' '));
  console.log('entry traces:', entryTraces.map(trace => trace.map(pc => hex(pc, 4)).join(' ')).join(' | '));
  if (scrollTrace.length) console.log('SCX:', scrollTrace.join(','));
  process.exit(0);
}
const visits = new Map();
const recent = [];
let cycles = 0;
let stopped = '';

for (let instruction = 0; instruction < limit; instruction++) {
  const interruptCycles = context.serviceInterrupts();
  if (interruptCycles) { cycles += interruptCycles; continue; }
  if (context.halting || context.stopping) {
    cycles += 4;
  } else {
    const pc = context.reg[ids.PC];
    const opcode = context.readMem(pc);
    visits.set(pc, (visits.get(pc) || 0) + 1);
    recent.push([pc, opcode]);
    if (recent.length > 32) recent.shift();
    const used = context.decode[opcode]();
    if (!Number.isFinite(used)) {
      stopped = `unsupported opcode ${hex(opcode, 2)} at ${hex(pc, 4)}`;
      break;
    }
    cycles += used;
  }
  const frameCycle = cycles % 70224;
  const line = Math.min(153, Math.floor(frameCycle / 456));
  context.updateLcdStatus(line);
  if (frameCycle < 8 && cycles > 8) context.requestInterrupt(0);
}

function hex(value, width) { return '0x' + value.toString(16).padStart(width, '0').toUpperCase(); }
const hot = [...visits].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`${info.title}, ${rom.length} bytes, type ${hex(info.cartridgeType, 2)}`);
console.log(stopped || `instruction limit ${limit} reached`);
console.log(`PC=${hex(context.reg[ids.PC], 4)} SP=${hex(context.reg[ids.SP], 4)} cycles=${cycles}`);
console.log('Recent:', recent.map(([pc, op]) => `${hex(pc, 4)}:${hex(op, 2)}`).join(' '));
console.log('Hot PCs:', hot.map(([pc, count]) => `${hex(pc, 4)}=${count}`).join(' '));
