const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cpuSource = fs.readFileSync(path.join(__dirname, '..', 'LR35902.js'), 'utf8');
const mainSource = ['GBmemorymapper.js', 'GBhardware.js', 'GBprocessor.js', 'main.js']
  .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  .join('\n');

function cpu() {
  const context = vm.createContext({ console: { log() {} }, Uint8Array });
  vm.runInContext(cpuSource, context, { filename: 'LR35902.js' });
  // Top-level const bindings live in the VM's lexical environment rather than
  // as properties on the context object. Export only the symbolic IDs needed
  // by the black-box test harness.
  Object.assign(context, vm.runInContext(
    '({ A, F, B, C, D, E, H, L, AF, BC, DE, HL, SP, PC, _Z, _N, _H, _C })',
    context,
  ));
  context.reg[context.AF] = 0;
  context.reg[context.BC] = 0;
  context.reg[context.DE] = 0;
  context.reg[context.HL] = 0;
  context.reg[context.SP] = 0xfffe;
  context.reg[context.PC] = 0x100;
  context.memory.fill(0);
  return context;
}

function execute(c, bytes) {
  const start = c.reg[c.PC];
  c.memory.set(bytes, start);
  return c.decode[c.memory[start]]();
}

function flags(c) {
  return {
    z: Boolean(c.getFlag(c._Z)),
    n: Boolean(c.getFlag(c._N)),
    h: Boolean(c.getFlag(c._H)),
    c: Boolean(c.getFlag(c._C)),
  };
}

test('NOP advances PC and takes 4 cycles', () => {
  const c = cpu();
  assert.equal(execute(c, [0x00]), 4);
  assert.equal(c.reg[c.PC], 0x101);
});

test('8-bit immediate loads cover every CPU register', async (t) => {
  const cases = [
    [0x06, 'B'], [0x0e, 'C'], [0x16, 'D'], [0x1e, 'E'],
    [0x26, 'H'], [0x2e, 'L'], [0x3e, 'A'],
  ];
  for (const [opcode, register] of cases) {
    await t.test(`LD ${register},d8 (0x${opcode.toString(16).padStart(2, '0')})`, () => {
      const c = cpu();
      assert.equal(execute(c, [opcode, 0xa5]), 8);
      assert.equal(c.getByteRegister(c[register]), 0xa5);
      assert.equal(c.reg[c.PC], 0x102);
    });
  }
});

test('16-bit immediate loads are little-endian', async (t) => {
  for (const [opcode, register] of [[0x01, 'BC'], [0x11, 'DE'], [0x21, 'HL'], [0x31, 'SP']]) {
    await t.test(`LD ${register},d16`, () => {
      const c = cpu();
      assert.equal(execute(c, [opcode, 0x34, 0x12]), 12);
      assert.equal(c.reg[c[register]], 0x1234);
      assert.equal(c.reg[c.PC], 0x103);
    });
  }
});

test('LD r,r matrix copies values and takes 4 cycles', () => {
  const registers = ['B', 'C', 'D', 'E', 'H', 'L', 'A'];
  const codes = [0, 1, 2, 3, 4, 5, 7];
  for (let dst = 0; dst < registers.length; dst++) {
    for (let src = 0; src < registers.length; src++) {
      const c = cpu();
      c.setByteRegister(c[registers[src]], 0x80 + src);
      const opcode = 0x40 | (codes[dst] << 3) | codes[src];
      assert.equal(execute(c, [opcode]), 4, `cycles for opcode 0x${opcode.toString(16)}`);
      assert.equal(c.getByteRegister(c[registers[dst]]), 0x80 + src,
        `result for opcode 0x${opcode.toString(16)}`);
    }
  }
});

test('loads through HL read and write memory', () => {
  const c = cpu();
  c.reg[c.HL] = 0xc123;
  c.memory[0xc123] = 0x5a;
  assert.equal(execute(c, [0x7e]), 8);
  assert.equal(c.getByteRegister(c.A), 0x5a);

  c.reg[c.PC] = 0x200;
  c.setByteRegister(c.A, 0x9c);
  assert.equal(execute(c, [0x77]), 8);
  assert.equal(c.memory[0xc123], 0x9c);
});

test('PUSH and POP preserve a 16-bit register', () => {
  const c = cpu();
  c.reg[c.BC] = 0xbeef;
  assert.equal(execute(c, [0xc5]), 16);
  assert.equal(c.reg[c.SP], 0xfffc);
  c.reg[c.BC] = 0;
  c.reg[c.PC] = 0x200;
  assert.equal(execute(c, [0xc1]), 12);
  assert.equal(c.reg[c.BC], 0xbeef);
  assert.equal(c.reg[c.SP], 0xfffe);
});

test('flags occupy F bits Z=7, N=6, H=5, C=4', () => {
  const c = cpu();
  c.setFlag(c._Z, true);
  c.setFlag(c._N, true);
  c.setFlag(c._H, true);
  c.setFlag(c._C, true);
  assert.equal(c.getByteRegister(c.F), 0xf0);
});

test('ADD A,B sets result, Z/N/H/C and cycles', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0x8f);
  c.setByteRegister(c.B, 0x81);
  assert.equal(execute(c, [0x80]), 4);
  assert.equal(c.getByteRegister(c.A), 0x10);
  assert.deepEqual(flags(c), { z: false, n: false, h: true, c: true });
});

test('SUB A,B sets borrow flags', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0x10);
  c.setByteRegister(c.B, 0x21);
  assert.equal(execute(c, [0x90]), 4);
  assert.equal(c.getByteRegister(c.A), 0xef);
  assert.deepEqual(flags(c), { z: false, n: true, h: true, c: true });
});

test('AND uses its encoded source register', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0xf3);
  c.setByteRegister(c.C, 0x5a);
  execute(c, [0xa1]);
  assert.equal(c.getByteRegister(c.A), 0x52);
});

test('all INC r opcodes increment their encoded register', () => {
  const opcodes = [[0x04, 'B'], [0x0c, 'C'], [0x14, 'D'], [0x1c, 'E'], [0x24, 'H'], [0x2c, 'L'], [0x3c, 'A']];
  for (const [opcode, register] of opcodes) {
    const c = cpu();
    c.setByteRegister(c[register], 0x40);
    execute(c, [opcode]);
    assert.equal(c.getByteRegister(c[register]), 0x41, `opcode 0x${opcode.toString(16)}`);
  }
});

test('INC (HL) changes memory at HL only', () => {
  const c = cpu();
  c.reg[c.HL] = 0xc000;
  c.memory[0xc000] = 0xff;
  assert.equal(execute(c, [0x34]), 12);
  assert.equal(c.memory[0xc000], 0x00);
  assert.deepEqual(flags(c), { z: true, n: false, h: true, c: false });
  assert.equal(c.reg[c.PC], 0x101);
});

test('JR adds signed displacement relative to the following instruction', () => {
  const c = cpu();
  assert.equal(execute(c, [0x18, 0xfe]), 12);
  assert.equal(c.reg[c.PC], 0x100);
});

test('JP cc follows the named condition', () => {
  const c = cpu();
  c.setFlag(c._Z, false);
  assert.equal(execute(c, [0xc2, 0x34, 0x12]), 16);
  assert.equal(c.reg[c.PC], 0x1234);
});

test('JP (HL) jumps to HL itself', () => {
  const c = cpu();
  c.reg[c.HL] = 0xc123;
  execute(c, [0xe9]);
  assert.equal(c.reg[c.PC], 0xc123);
});

test('RLCA rotates bit 7 into bit 0 and clears Z', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0x81);
  execute(c, [0x07]);
  assert.equal(c.getByteRegister(c.A), 0x03);
  assert.deepEqual(flags(c), { z: false, n: false, h: false, c: true });
});

test('CB RLC B consumes two bytes and rotates correctly', () => {
  const c = cpu();
  c.setByteRegister(c.B, 0x80);
  assert.equal(execute(c, [0xcb, 0x00]), 8);
  assert.equal(c.getByteRegister(c.B), 0x01);
  assert.equal(c.reg[c.PC], 0x102);
  assert.deepEqual(flags(c), { z: false, n: false, h: false, c: true });
});

test('CB BIT/RES/SET decode bit number from opcode', () => {
  const c = cpu();
  c.setByteRegister(c.B, 0x08);
  execute(c, [0xcb, 0x58]); // BIT 3,B
  assert.equal(flags(c).z, false);
  c.reg[c.PC] = 0x200;
  execute(c, [0xcb, 0x98]); // RES 3,B
  assert.equal(c.getByteRegister(c.B), 0x00);
  c.reg[c.PC] = 0x300;
  execute(c, [0xcb, 0xd8]); // SET 3,B
  assert.equal(c.getByteRegister(c.B), 0x08);
});

test('LD (a16),A writes to the immediate address', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0x6d);
  assert.equal(execute(c, [0xea, 0x23, 0xc1]), 16);
  assert.equal(c.memory[0xc123], 0x6d);
});

test('LDH writes and reads through the FF00 page', () => {
  const c = cpu();
  c.setByteRegister(c.A, 0x7b);
  assert.equal(execute(c, [0xe0, 0x42]), 12);
  assert.equal(c.memory[0xff42], 0x7b);
  c.setByteRegister(c.A, 0);
  c.reg[c.PC] = 0x200;
  assert.equal(execute(c, [0xf0, 0x42]), 12);
  assert.equal(c.getByteRegister(c.A), 0x7b);
});

test('CALL and RET preserve the return address', () => {
  const c = cpu();
  assert.equal(execute(c, [0xcd, 0x00, 0x40]), 24);
  assert.equal(c.reg[c.PC], 0x4000);
  assert.equal(c.reg[c.SP], 0xfffc);
  c.memory[0x4000] = 0xc9;
  assert.equal(c.decode[0xc9](), 16);
  assert.equal(c.reg[c.PC], 0x103);
  assert.equal(c.reg[c.SP], 0xfffe);
});

test('ROM loader maps cartridge bytes and resets the CPU', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x8000);
  rom.set(Buffer.from('TEST GAME'), 0x134);
  rom[0x100] = 0xc3;
  rom[0x147] = 0x01;

  const info = c.loadRomBytes(rom);
  assert.equal(info.title, 'TEST GAME');
  assert.equal(info.bytes, 0x8000);
  assert.equal(info.cartridgeType, 0x01);
  assert.equal(c.memory[0x100], 0xc3);
  assert.equal(c.reg[c.PC], 0x100);
  assert.equal(c.reg[c.SP], 0xfffe);
  assert.equal(c.memory[0xff40], 0x91);
  assert.equal(c.memory[0xff47], 0xfc);
  c.memory[0xff43] = 7;
  c.runCpuFrame();
  assert.equal(c.memory[0xff44], 0);
  assert.notEqual(c.reg[c.PC], 0x100);
  assert.equal(c.scanlineScrollX[0], 7);
  assert.equal(c.scanlineScrollX[143], 7);
  c.updateLcdStatus(12, 0);
  assert.equal(c.memory[0xff41] & 0x03, 0);
  c.updateLcdStatus(12, 3);
  assert.equal(c.memory[0xff41] & 0x03, 3);
});

test('ROM loader rejects files without a cartridge header', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  assert.throws(() => c.loadRomBytes(new Uint8Array(32)), /too small/);
});

test('MBC1 writes select a ROM bank without overwriting cartridge data', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x10000);
  rom[0x147] = 0x01;
  rom[0x4000] = 0x11;
  rom[0xc000] = 0x33;
  c.loadRomBytes(rom);
  assert.equal(c.readMem(0x4000), 0x11);
  c.writeMem(0x2000, 0x03);
  assert.equal(c.readMem(0x4000), 0x33);
  assert.equal(c.loadedRom[0x2000], 0x00);
});

test('MBC3 supports seven-bit ROM banks and banked cartridge RAM', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x100000);
  rom[0x147] = 0x13;
  rom[0x149] = 0x03;
  rom[0x21 * 0x4000] = 0x67;
  c.loadRomBytes(rom);
  c.writeMem(0x2000, 0x21);
  assert.equal(c.readMem(0x4000), 0x67);
  c.writeMem(0x0000, 0x0a);
  c.writeMem(0x4000, 0x02);
  c.writeMem(0xa000, 0x91);
  c.writeMem(0x4000, 0x01);
  assert.equal(c.readMem(0xa000), 0x00);
  c.writeMem(0x4000, 0x02);
  assert.equal(c.readMem(0xa000), 0x91);
});

test('MBC5 supports nine-bit ROM selection and four-bit RAM banks', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x100000);
  rom[0x147] = 0x1b;
  rom[0x149] = 0x04;
  rom[0x21 * 0x4000] = 0x5c;
  c.loadRomBytes(rom);
  c.writeMem(0x2000, 0x21);
  assert.equal(c.readMem(0x4000), 0x5c);
  c.writeMem(0x3000, 1);
  assert.equal(c.activeRomBank, 0x121);
  c.writeMem(0x0000, 0x0a);
  c.writeMem(0x4000, 0x07);
  c.writeMem(0xa123, 0xd4);
  c.writeMem(0x4000, 0x02);
  assert.equal(c.readMem(0xa123), 0);
  c.writeMem(0x4000, 0x07);
  assert.equal(c.readMem(0xa123), 0xd4);
});

test('MBC2 uses address bit 8 for control and stores 512 four-bit values', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x40000);
  rom[0x147] = 0x06;
  rom[3 * 0x4000] = 0x73;
  c.loadRomBytes(rom);
  c.writeMem(0x2100, 3);
  assert.equal(c.readMem(0x4000), 0x73);
  c.writeMem(0x0000, 0x0a);
  c.writeMem(0xa123, 0xbc);
  assert.equal(c.readMem(0xa123), 0xfc);
  assert.equal(c.readMem(0xa323), 0xfc);
});

test('all standard cartridge header types are recognized', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const types = [0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x08, 0x09,
    0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x19, 0x1a,
    0x1b, 0x1c, 0x1d, 0x1e, 0x20, 0x22, 0xfc, 0xfd, 0xfe, 0xff];
  for (const type of types) {
    const rom = new Uint8Array(0x8000);
    rom[0x147] = type;
    const info = c.loadRomBytes(rom);
    assert.notEqual(info.cartridgeTypeName, 'UNKNOWN', `type 0x${type.toString(16)}`);
  }
});

test('joypad reads report no buttons pressed by default', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  const rom = new Uint8Array(0x8000);
  c.loadRomBytes(rom);
  c.writeMem(0xff00, 0x10);
  assert.equal(c.readMem(0xff00), 0xdf);
  c.writeMem(0xff00, 0x20);
  assert.equal(c.readMem(0xff00), 0xef);
  c.writeMem(0xff00, 0x10);
  c.setJoypadButton('a', true);
  assert.equal(c.readMem(0xff00), 0xde);
  assert.equal(c.memory[0xff0f] & 0x10, 0x10);
  c.setJoypadButton('a', false);
  assert.equal(c.readMem(0xff00), 0xdf);
});

test('OAM DMA copies 160 bytes from the selected source page', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  for (let i = 0; i < 0xa0; i++) c.memory[0xc000 + i] = i ^ 0x5a;
  c.writeMem(0xff46, 0xc0);
  for (let i = 0; i < 0xa0; i++) assert.equal(c.memory[0xfe00 + i], i ^ 0x5a);
});

test('sprite renderer draws an opaque OAM pixel', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  c.canvasContext = { putImageData() {} };
  c.frameImage = { data: new Uint8ClampedArray(160 * 144 * 4) };
  c.memory[0xff40] = 0x82; // LCD and objects on, background off
  c.memory[0xff48] = 0xe4;
  c.memory[0x8000] = 0x80; // colour 1 at the tile's upper-left pixel
  c.memory[0xfe00] = 16;
  c.memory[0xfe01] = 8;
  c.memory[0xfe02] = 0;
  c.memory[0xfe03] = 0;
  c.renderBackground();
  assert.equal(c.frameImage.data[1], 168);
  assert.equal(c.frameImage.data[3], 255);
});

test('DIV and TIMA retain cycle remainders and request timer interrupts', () => {
  const c = cpu();
  c.document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  };
  vm.runInContext(mainSource, c, { filename: 'main.js' });
  c.memory[0xff04] = 0;
  c.advanceHardwareTimers(255);
  assert.equal(c.memory[0xff04], 0);
  c.advanceHardwareTimers(1);
  assert.equal(c.memory[0xff04], 1);

  c.memory[0xff07] = 0x05; // enabled, 16-cycle period
  c.memory[0xff05] = 0xff;
  c.memory[0xff06] = 0x42;
  c.memory[0xff0f] = 0;
  c.advanceHardwareTimers(16);
  assert.equal(c.memory[0xff05], 0x42);
  assert.equal(c.memory[0xff0f] & 0x04, 0x04);
});
