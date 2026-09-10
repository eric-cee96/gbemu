const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const [romPath, outputDir] = process.argv.slice(2);
if (!romPath) throw new Error('Usage: node tools/smoke-rom.js <rom.gb> [capture-directory]');
const c = vm.createContext({ console: { log() {} }, Uint8Array,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } } });
for (const file of ['LR35902.js', 'GBmemorymapper.js', 'GBhardware.js', 'GBprocessor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
}
console.log(c.loadRomBytes(new Uint8Array(fs.readFileSync(romPath)))) ;
c.frameImage = { data: new Uint8Array(160 * 144 * 4) };
c.canvasContext = { putImageData() {} };
const events = new Map([[180, ['start', true]], [190, ['start', false]],
  [360, ['start', true]], [370, ['start', false]], [540, ['start', true]], [550, ['start', false]],
  [720, ['right', true]], [900, ['a', true]], [920, ['a', false]], [1100, ['right', false]]]);
const hashes = new Set();
for (let frame = 0; frame < 1200; frame++) {
  if (events.has(frame)) c.setJoypadButton(...events.get(frame));
  c.runCpuFrame();
  if ([179, 359, 539, 719, 899, 1199].includes(frame)) {
    c.renderBackground();
    const pixels = Buffer.from(c.frameImage.data);
    const hash = require('node:crypto').createHash('sha256').update(pixels).digest('hex');
    hashes.add(hash);
    assert.ok(new Set(pixels).size > 4, 'Screen should contain rendered graphics');
    console.log(`Frame ${frame + 1}: bank=${c.activeRomBank}, screen=${hash.slice(0, 16)}`);
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      // Uncompressed 32-bit BMP, bottom-up BGRA pixels.
      const bmp = Buffer.alloc(54 + pixels.length);
      bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
      bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(160, 18); bmp.writeInt32LE(144, 22);
      bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(32, 28);
      for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) {
        const src = (y * 160 + x) * 4, dst = 54 + ((143 - y) * 160 + x) * 4;
        bmp[dst] = pixels[src + 2]; bmp[dst + 1] = pixels[src + 1];
        bmp[dst + 2] = pixels[src]; bmp[dst + 3] = 255;
      }
      fs.writeFileSync(path.join(outputDir, `frame-${frame + 1}.bmp`), bmp);
    }
  }
}
assert.ok(hashes.size > 1, 'Screen should change during the session');
console.log('Completed 1200 frames with input and changing rendered graphics.');
