// The complete cartridge image. The CPU currently maps the first 32 KiB;
// future memory-bank-controller code can use this array for bank switching.
var loadedRom = null;
var activeRomBank = 1;
var activeRamBank = 0;
var mbc1UpperBits = 0;
var mbc1Mode = 0;
var mapperKind = 'ROM';
var cartridgeRamEnabled = false;
var cartridgeRam = new Uint8Array(0x8000);
var rawReadMem = readMem;
var rawWriteMem = writeMem;
var emulationRunning = false;
var animationFrameId = null;
var loadedRomName = '';
var statusElement = null;
var canvasContext = null;
var frameImage = null;
var backgroundColourIds = new Uint8Array(160 * 144);
var scanlineScrollX = new Uint8Array(144);
var scanlineScrollY = new Uint8Array(144);
var clockSpeed = 1;
var speedAccumulator = 0;
var joypadButtons = 0xFF;
var dividerCycleAccumulator = 0;
var timerCycleAccumulator = 0;
var gameBoyApu = null;

var CYCLES_PER_FRAME = 70224;
var FRAME_CYCLE_LIMIT = CYCLES_PER_FRAME * 2;

readMem = function(address) {
    address &= 0xFFFF;
    if (address === 0xFF00) {
        // Bits 4/5 select a group; button signals and selection are active-low.
        var select = memory[0xFF00] & 0x30;
        var inputs = 0x0F;
        if ((select & 0x10) === 0) inputs &= joypadButtons & 0x0F;
        if ((select & 0x20) === 0) inputs &= (joypadButtons >> 4) & 0x0F;
        return 0xC0 | select | inputs;
    }
    if (loadedRom && address < 0x4000) {
        var bank0 = mapperKind === 'MBC1' && mbc1Mode ? (mbc1UpperBits << 5) : 0;
        var bank0Offset = bank0 * 0x4000 + address;
        return loadedRom[bank0Offset % loadedRom.length];
    }
    if (loadedRom && address < 0x8000) {
        var bank = mapperKind === 'MBC1'
            ? activeRomBank | (mbc1UpperBits << 5)
            : activeRomBank;
        var offset = bank * 0x4000 + (address - 0x4000);
        return loadedRom[offset % loadedRom.length];
    }
    if (address >= 0xA000 && address <= 0xBFFF && cartridgeRamEnabled) {
        if (mapperKind === 'MBC3' && activeRamBank > 3) return 0xFF; // RTC not implemented
        var ramBank = mapperKind === 'MBC1' && mbc1Mode ? mbc1UpperBits : activeRamBank;
        return cartridgeRam[ramBank * 0x2000 + address - 0xA000];
    }
    if (address >= 0xE000 && address <= 0xFDFF) return memory[address - 0x2000];
    return rawReadMem(address);
};

writeMem = function(address, value) {
    address &= 0xFFFF;
    value &= 0xFF;
    if (loadedRom && address < 0x8000 && mapperKind === 'ROM') return;
    if (loadedRom && address < 0x2000) {
        cartridgeRamEnabled = (value & 0x0F) === 0x0A;
        return;
    }
    if (address === 0xFF46) {
        memory[0xFF46] = value;
        var source = value << 8;
        for (var dmaByte = 0; dmaByte < 0xA0; dmaByte++) {
            memory[0xFE00 + dmaByte] = readMem((source + dmaByte) & 0xFFFF);
        }
        return;
    }
    if (loadedRom && address < 0x4000) {
        activeRomBank = mapperKind === 'MBC3' ? value & 0x7F : value & 0x1F;
        if (activeRomBank === 0) activeRomBank = 1;
        return;
    }
    if (loadedRom && address < 0x6000) {
        if (mapperKind === 'MBC3') activeRamBank = value;
        else mbc1UpperBits = value & 0x03;
        return;
    }
    if (loadedRom && address < 0x8000) {
        if (mapperKind === 'MBC1') mbc1Mode = value & 1;
        return;
    }
    if (address >= 0xA000 && address <= 0xBFFF && cartridgeRamEnabled) {
        if (mapperKind === 'MBC3' && activeRamBank > 3) return; // RTC not implemented
        var ramBank = mapperKind === 'MBC1' && mbc1Mode ? mbc1UpperBits : activeRamBank;
        cartridgeRam[ramBank * 0x2000 + address - 0xA000] = value;
        return;
    }
    if (address >= 0xC000 && address <= 0xDDFF) {
        memory[address] = value;
        memory[address + 0x2000] = value;
        return;
    }
    if (address >= 0xE000 && address <= 0xFDFF) {
        memory[address] = value;
        memory[address - 0x2000] = value;
        return;
    }
    if (address === 0xFF00) {
        memory[0xFF00] = 0xC0 | (value & 0x30) | 0x0F;
        return;
    }
    if (address === 0xFF04) {
        dividerCycleAccumulator = 0;
        value = 0;
    }
    rawWriteMem(address, value);
    if (gameBoyApu && ((address >= 0xFF10 && address <= 0xFF26) ||
        (address >= 0xFF30 && address <= 0xFF3F))) {
        gameBoyApu.write(address, value);
    }
};

function GameBoyApu(audioContext) {
    this.context = audioContext;
    this.master = audioContext.createGain();
    this.master.gain.value = 0.5;
    this.processor = audioContext.createScriptProcessor(1024, 0, 2);
    this.processor.connect(this.master);
    this.master.connect(audioContext.destination);
    this.phase = [0, 0, 0, 0];
    this.lfsr = 0x7FFF;
    this.noiseClock = 0;
    this.processor.onaudioprocess = this.render.bind(this);
}

GameBoyApu.prototype.write = function(address, value) {
    // Trigger writes restart the corresponding oscillator phase/noise state.
    if ((address === 0xFF14 || address === 0xFF19 || address === 0xFF1E || address === 0xFF23) &&
        (value & 0x80)) {
        var channel = address === 0xFF14 ? 0 : address === 0xFF19 ? 1 : address === 0xFF1E ? 2 : 3;
        this.phase[channel] = 0;
        if (channel === 3) this.lfsr = 0x7FFF;
    }
};

GameBoyApu.prototype.pulseSample = function(channel, nrx1, nrx2, nrx3, nrx4, sampleRate) {
    if ((memory[nrx2] & 0xF8) === 0) return 0;
    var rawFrequency = memory[nrx3] | ((memory[nrx4] & 7) << 8);
    var frequency = 131072 / Math.max(1, 2048 - rawFrequency);
    this.phase[channel] = (this.phase[channel] + frequency / sampleRate) % 1;
    var duties = [0.125, 0.25, 0.5, 0.75];
    var duty = duties[memory[nrx1] >> 6];
    var volume = ((memory[nrx2] >> 4) & 0x0F) / 15;
    return (this.phase[channel] < duty ? 1 : -1) * volume;
};

GameBoyApu.prototype.waveSample = function(sampleRate) {
    if ((memory[0xFF1A] & 0x80) === 0) return 0;
    var rawFrequency = memory[0xFF1D] | ((memory[0xFF1E] & 7) << 8);
    var frequency = 65536 / Math.max(1, 2048 - rawFrequency);
    this.phase[2] = (this.phase[2] + frequency / sampleRate) % 1;
    var position = Math.floor(this.phase[2] * 32) & 31;
    var packed = memory[0xFF30 + (position >> 1)];
    var sample = position & 1 ? packed & 0x0F : packed >> 4;
    var levelCode = (memory[0xFF1C] >> 5) & 3;
    if (levelCode === 0) return 0;
    sample >>= levelCode - 1;
    return (sample / 7.5) - 1;
};

GameBoyApu.prototype.noiseSample = function(sampleRate) {
    if ((memory[0xFF21] & 0xF8) === 0) return 0;
    var nr43 = memory[0xFF22];
    var divisors = [8, 16, 32, 48, 64, 80, 96, 112];
    var frequency = 524288 / divisors[nr43 & 7] / Math.pow(2, (nr43 >> 4) + 1);
    this.noiseClock += frequency / sampleRate;
    while (this.noiseClock >= 1) {
        this.noiseClock--;
        var feedback = (this.lfsr ^ (this.lfsr >> 1)) & 1;
        this.lfsr = (this.lfsr >> 1) | (feedback << 14);
        if (nr43 & 0x08) this.lfsr = (this.lfsr & ~(1 << 6)) | (feedback << 6);
    }
    var volume = ((memory[0xFF21] >> 4) & 0x0F) / 15;
    return (this.lfsr & 1 ? -1 : 1) * volume;
};

GameBoyApu.prototype.render = function(event) {
    var left = event.outputBuffer.getChannelData(0);
    var right = event.outputBuffer.getChannelData(1);
    var sampleRate = this.context.sampleRate;
    var enabled = Boolean(memory[0xFF26] & 0x80);
    var routing = memory[0xFF25];
    var volumes = memory[0xFF24];
    for (var i = 0; i < left.length; i++) {
        if (!enabled) { left[i] = right[i] = 0; continue; }
        var samples = [
            this.pulseSample(0, 0xFF11, 0xFF12, 0xFF13, 0xFF14, sampleRate),
            this.pulseSample(1, 0xFF16, 0xFF17, 0xFF18, 0xFF19, sampleRate),
            this.waveSample(sampleRate),
            this.noiseSample(sampleRate),
        ];
        var l = 0, r = 0;
        for (var channel = 0; channel < 4; channel++) {
            if (routing & (1 << channel)) r += samples[channel];
            if (routing & (1 << (channel + 4))) l += samples[channel];
        }
        left[i] = l * (((volumes >> 4) & 7) + 1) / 32;
        right[i] = r * ((volumes & 7) + 1) / 32;
    }
};

function ensureAudio() {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!gameBoyApu) gameBoyApu = new GameBoyApu(new AudioContextClass());
    if (gameBoyApu.context.state === 'suspended') gameBoyApu.context.resume();
    var button = document.getElementById('sound-button');
    if (button) button.textContent = 'Sound enabled';
    return true;
}

function cartridgeTitle(rom) {
    var chars = [];
    for (var i = 0x134; i <= 0x143 && i < rom.length; i++) {
        if (rom[i] === 0) break;
        if (rom[i] >= 0x20 && rom[i] <= 0x7E) chars.push(String.fromCharCode(rom[i]));
    }
    return chars.join('').trim() || 'Untitled cartridge';
}

function resetCpuForCartridge() {
    // Post-boot DMG register values. Starting at 0100 skips the boot ROM,
    // which would otherwise overwrite the cartridge area in this early core.
    reg[AF] = 0x01B0;
    reg[BC] = 0x0013;
    reg[DE] = 0x00D8;
    reg[HL] = 0x014D;
    reg[SP] = 0xFFFE;
    reg[PC] = 0x0100;
    halting = false;
    stopping = false;
    IME = true;

    // Hardware state left by the original DMG boot ROM. Cartridges expect
    // these values when execution begins directly at 0100.
    memory[0xFF00] = 0xCF;
    memory[0xFF04] = 0xAB;
    memory[0xFF05] = 0x00;
    memory[0xFF06] = 0x00;
    memory[0xFF07] = 0xF8;
    memory[0xFF0F] = 0xE1;
    memory[0xFF40] = 0x91;
    memory[0xFF41] = 0x85;
    memory[0xFF42] = 0x00;
    memory[0xFF43] = 0x00;
    memory[0xFF44] = 0x00;
    memory[0xFF45] = 0x00;
    memory[0xFF47] = 0xFC;
    memory[0xFF48] = 0xFF;
    memory[0xFF49] = 0xFF;
    memory[0xFF4A] = 0x00;
    memory[0xFF4B] = 0x00;
    memory[0xFFFF] = 0x00;
    scanlineScrollX.fill(memory[0xFF43]);
    scanlineScrollY.fill(memory[0xFF42]);
}

function loadRomBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('ROM data must be a Uint8Array.');
    if (bytes.length < 0x150) throw new Error('This file is too small to contain a Game Boy cartridge header.');

    loadedRom = new Uint8Array(bytes);
    var cartridgeType = loadedRom[0x147];
    mapperKind = cartridgeType >= 0x01 && cartridgeType <= 0x03 ? 'MBC1'
        : cartridgeType >= 0x0F && cartridgeType <= 0x13 ? 'MBC3' : 'ROM';
    activeRomBank = 1;
    activeRamBank = 0;
    mbc1UpperBits = 0;
    mbc1Mode = 0;
    cartridgeRamEnabled = false;
    cartridgeRam.fill(0);
    joypadButtons = 0xFF;
    dividerCycleAccumulator = 0;
    timerCycleAccumulator = 0;
    memory.fill(0);
    memory.set(loadedRom.subarray(0, Math.min(0x8000, loadedRom.length)), 0);
    resetCpuForCartridge();

    return {
        title: cartridgeTitle(loadedRom),
        bytes: loadedRom.length,
        cartridgeType: cartridgeType,
    };
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
    return (bytes / 1024).toFixed(0) + ' KiB';
}

function requestInterrupt(bit) {
    memory[0xFF0F] |= 1 << bit;
}

function serviceInterrupts() {
    var pending = memory[0xFFFF] & memory[0xFF0F] & 0x1F;
    if (!pending) return 0;
    halting = false;
    if (!IME) return 0;

    var vectors = [0x40, 0x48, 0x50, 0x58, 0x60];
    for (var bit = 0; bit < 5; bit++) {
        if (pending & (1 << bit)) {
            IME = false;
            memory[0xFF0F] &= ~(1 << bit);
            pushWord(reg[PC]);
            reg[PC] = vectors[bit];
            return 20;
        }
    }
    return 0;
}

function updateLcdStatus(line, mode) {
    memory[0xFF44] = line;
    var stat = memory[0xFF41] & 0xF8;
    if (mode === undefined) mode = line >= 144 ? 1 : 2;
    stat |= mode;
    if (line === memory[0xFF45]) {
        stat |= 0x04;
        if ((stat & 0x40) && mode === 2) requestInterrupt(1);
    }
    memory[0xFF41] = stat;
    if (mode === 0 && (stat & 0x08)) requestInterrupt(1);
    if (mode === 1 && line === 144 && (stat & 0x10)) requestInterrupt(1);
    if (mode === 2 && (stat & 0x20)) requestInterrupt(1);
}

function advanceHardwareTimers(cycles) {
    dividerCycleAccumulator += cycles;
    while (dividerCycleAccumulator >= 256) {
        dividerCycleAccumulator -= 256;
        memory[0xFF04] = (memory[0xFF04] + 1) & 0xFF;
    }

    var tac = memory[0xFF07];
    if ((tac & 0x04) === 0) {
        timerCycleAccumulator = 0;
        return;
    }
    var periods = [1024, 16, 64, 256];
    var period = periods[tac & 0x03];
    timerCycleAccumulator += cycles;
    while (timerCycleAccumulator >= period) {
        timerCycleAccumulator -= period;
        if (memory[0xFF05] === 0xFF) {
            memory[0xFF05] = memory[0xFF06];
            requestInterrupt(2);
        } else {
            memory[0xFF05]++;
        }
    }
}

function runCpuCycles(budget) {
    var elapsed = 0;
    var safety = 0;
    while (elapsed < budget && safety < FRAME_CYCLE_LIMIT) {
        safety++;
        var interruptCycles = serviceInterrupts();
        if (interruptCycles) {
            elapsed += interruptCycles;
            continue;
        }
        if (halting || stopping) {
            elapsed += 4;
            continue;
        }
        var opcode = readMem(reg[PC]);
        var cycles = decode[opcode]();
        if (!Number.isFinite(cycles)) {
            throw new Error('Opcode 0x' + opcode.toString(16).padStart(2, '0').toUpperCase() +
                ' is not implemented at PC 0x' + reg[PC].toString(16).padStart(4, '0').toUpperCase());
        }
        elapsed += cycles;
    }
    advanceHardwareTimers(elapsed);
    return elapsed;
}

function runCpuFrame() {
    // 144 visible lines plus 10 VBlank lines, 456 CPU cycles per line.
    // Updating LY between each slice allows the cartridge's LCD polling loops
    // to progress instead of locking forever on a single scanline.
    for (var line = 0; line < 144; line++) {
        updateLcdStatus(line, 2); // OAM scan
        runCpuCycles(80);
        // Games can change scrolling during HBlank/STAT handlers to create
        // split-screen effects. Preserve the value active for each scanline.
        scanlineScrollX[line] = memory[0xFF43];
        scanlineScrollY[line] = memory[0xFF42];
        updateLcdStatus(line, 3); // Pixel transfer
        runCpuCycles(172);
        updateLcdStatus(line, 0); // HBlank
        runCpuCycles(204);
    }
    for (var vblankLine = 144; vblankLine < 154; vblankLine++) {
        updateLcdStatus(vblankLine, 1);
        if (vblankLine === 144) requestInterrupt(0);
        runCpuCycles(456);
    }
    memory[0xFF44] = 0;
}

function renderBackground() {
    if (!canvasContext || !frameImage) return;
    var data = frameImage.data;
    var lcdc = memory[0xFF40];
    var palette = memory[0xFF47];
    var shades = [224, 168, 96, 24];

    if ((lcdc & 0x80) === 0) {
        data.fill(0);
        backgroundColourIds.fill(0);
        canvasContext.putImageData(frameImage, 0, 0);
        return;
    }

    var mapBase = (lcdc & 0x08) ? 0x9C00 : 0x9800;
    var windowMapBase = (lcdc & 0x40) ? 0x9C00 : 0x9800;
    var unsignedTiles = Boolean(lcdc & 0x10);
    for (var y = 0; y < 144; y++) {
        var scrollX = scanlineScrollX[y];
        var scrollY = scanlineScrollY[y];
        var worldY = (y + scrollY) & 0xFF;
        for (var x = 0; x < 160; x++) {
            var worldX = (x + scrollX) & 0xFF;
            var colour = 0;
            if (lcdc & 0x01) {
                var tileX = worldX;
                var tileY = worldY;
                var selectedMap = mapBase;
                var windowLeft = memory[0xFF4B] - 7;
                if ((lcdc & 0x20) && y >= memory[0xFF4A] && x >= windowLeft) {
                    tileX = x - windowLeft;
                    tileY = y - memory[0xFF4A];
                    selectedMap = windowMapBase;
                }
                var tileId = memory[selectedMap + ((tileY >> 3) * 32) + (tileX >> 3)];
                var tileAddress = unsignedTiles
                    ? 0x8000 + tileId * 16
                    : 0x9000 + uncomplement(tileId, 8) * 16;
                var row = (tileY & 7) * 2;
                var bit = 7 - (tileX & 7);
                colour = ((memory[tileAddress + row] >> bit) & 1) |
                    (((memory[tileAddress + row + 1] >> bit) & 1) << 1);
            }
            backgroundColourIds[y * 160 + x] = colour;
            var shade = shades[(palette >> (colour * 2)) & 3];
            var offset = (y * 160 + x) * 4;
            data[offset] = shade * 0.72;
            data[offset + 1] = shade;
            data[offset + 2] = shade * 0.62;
            data[offset + 3] = 255;
        }
    }
    renderSprites(data, lcdc, shades);
    canvasContext.putImageData(frameImage, 0, 0);
}

function renderSprites(data, lcdc, shades) {
    if ((lcdc & 0x02) === 0) return;
    var height = (lcdc & 0x04) ? 16 : 8;

    for (var screenY = 0; screenY < 144; screenY++) {
        var sprites = [];
        for (var index = 0; index < 40 && sprites.length < 10; index++) {
            var base = 0xFE00 + index * 4;
            var spriteY = memory[base] - 16;
            if (screenY >= spriteY && screenY < spriteY + height) {
                sprites.push({ index: index, x: memory[base + 1] - 8, y: spriteY,
                    tile: memory[base + 2], flags: memory[base + 3] });
            }
        }

        // Smaller X coordinates have priority; OAM order breaks equal-X ties.
        // Draw in reverse priority so the highest-priority pixel lands last.
        sprites.sort(function(a, b) {
            return b.x === a.x ? b.index - a.index : b.x - a.x;
        });

        sprites.forEach(function(sprite) {
            var row = screenY - sprite.y;
            if (sprite.flags & 0x40) row = height - 1 - row;
            var tile = height === 16 ? (sprite.tile & 0xFE) : sprite.tile;
            if (row >= 8) { tile++; row -= 8; }
            var tileAddress = 0x8000 + tile * 16 + row * 2;
            var low = memory[tileAddress];
            var high = memory[tileAddress + 1];
            var objectPalette = memory[(sprite.flags & 0x10) ? 0xFF49 : 0xFF48];

            for (var column = 0; column < 8; column++) {
                var screenX = sprite.x + column;
                if (screenX < 0 || screenX >= 160) continue;
                var sourceColumn = (sprite.flags & 0x20) ? 7 - column : column;
                var bit = 7 - sourceColumn;
                var colour = ((low >> bit) & 1) | (((high >> bit) & 1) << 1);
                if (colour === 0) continue;
                var pixel = screenY * 160 + screenX;
                if ((sprite.flags & 0x80) && backgroundColourIds[pixel] !== 0) continue;
                var shade = shades[(objectPalette >> (colour * 2)) & 3];
                var offset = pixel * 4;
                data[offset] = shade * 0.72;
                data[offset + 1] = shade;
                data[offset + 2] = shade * 0.62;
                data[offset + 3] = 255;
            }
        });
    }
}

function emulationFrame() {
    if (!emulationRunning) return;
    try {
        speedAccumulator += clockSpeed;
        while (speedAccumulator >= 1) {
            runCpuFrame();
            speedAccumulator--;
        }
        renderBackground();
        animationFrameId = requestAnimationFrame(emulationFrame);
    } catch (error) {
        pauseEmulation();
        if (statusElement) {
            statusElement.textContent = 'Emulation stopped: ' + error.message;
            statusElement.classList.add('error');
        }
    }
}

function startEmulation() {
    if (!loadedRom || emulationRunning) return;
    emulationRunning = true;
    if (statusElement) statusElement.classList.remove('error');
    var button = document.getElementById('run-button');
    if (button) button.textContent = 'Pause';
    animationFrameId = requestAnimationFrame(emulationFrame);
}

function pauseEmulation() {
    emulationRunning = false;
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    var button = document.getElementById('run-button');
    if (button) button.textContent = 'Run';
}

function resetEmulation() {
    if (!loadedRom) return;
    var wasRunning = emulationRunning;
    pauseEmulation();
    loadRomBytes(loadedRom);
    if (wasRunning) startEmulation();
}

var JOYPAD_BITS = {
    right: 0, left: 1, up: 2, down: 3,
    a: 4, b: 5, select: 6, start: 7,
};

function setJoypadButton(name, pressed) {
    var bit = JOYPAD_BITS[name];
    if (bit === undefined) return;
    var mask = 1 << bit;
    var wasReleased = Boolean(joypadButtons & mask);
    if (pressed) joypadButtons &= ~mask;
    else joypadButtons |= mask;
    if (pressed && wasReleased) requestInterrupt(4);
    var button = document.querySelector ? document.querySelector('[data-button="' + name + '"]') : null;
    if (button) button.classList.toggle('pressed', pressed);
}

function initialiseControls() {
    var keyMap = {
        ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down',
        KeyX: 'a', KeyZ: 'b', ShiftLeft: 'select', ShiftRight: 'select', Enter: 'start',
    };
    window.addEventListener('keydown', function(event) {
        var button = keyMap[event.code];
        if (!button) return;
        event.preventDefault();
        ensureAudio();
        setJoypadButton(button, true);
    });
    window.addEventListener('keyup', function(event) {
        var button = keyMap[event.code];
        if (!button) return;
        event.preventDefault();
        setJoypadButton(button, false);
    });
    window.addEventListener('blur', function() { joypadButtons = 0xFF; });

    document.querySelectorAll('[data-button]').forEach(function(button) {
        var name = button.dataset.button;
        var press = function(event) { event.preventDefault(); ensureAudio(); setJoypadButton(name, true); };
        var release = function(event) { event.preventDefault(); setJoypadButton(name, false); };
        button.addEventListener('pointerdown', press);
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
    });
}

function initialiseRomPicker() {
    var picker = document.getElementById('rom-file');
    var status = document.getElementById('rom-status');
    var runButton = document.getElementById('run-button');
    var resetButton = document.getElementById('reset-button');
    var canvas = document.getElementById('gbemucanv');
    var speed = document.getElementById('clock-speed');
    var speedValue = document.getElementById('clock-speed-value');
    var soundButton = document.getElementById('sound-button');
    var soundVolume = document.getElementById('sound-volume');
    var soundVolumeValue = document.getElementById('sound-volume-value');
    if (!picker || !status) return;
    statusElement = status;
    if (canvas) {
        canvasContext = canvas.getContext('2d');
        frameImage = canvasContext.createImageData(160, 144);
    }
    if (speed) speed.addEventListener('input', function() {
        clockSpeed = Number(speed.value);
        speedAccumulator = 0;
        if (speedValue) speedValue.textContent = clockSpeed.toFixed(2) + '×';
    });
    if (soundButton) soundButton.addEventListener('click', ensureAudio);
    if (soundVolume) soundVolume.addEventListener('input', function() {
        var volume = Number(soundVolume.value);
        if (gameBoyApu) gameBoyApu.master.gain.value = volume;
        if (soundVolumeValue) soundVolumeValue.textContent = Math.round(volume * 100) + '%';
    });
    initialiseControls();

    if (runButton) runButton.addEventListener('click', function() {
        if (emulationRunning) pauseEmulation(); else startEmulation();
    });
    if (resetButton) resetButton.addEventListener('click', resetEmulation);

    picker.addEventListener('change', async function() {
        var file = picker.files && picker.files[0];
        if (!file) {
            status.textContent = 'No ROM loaded.';
            status.classList.remove('error');
            return;
        }

        status.textContent = 'Loading ' + file.name + '…';
        status.classList.remove('error');
        try {
            pauseEmulation();
            var info = loadRomBytes(new Uint8Array(await file.arrayBuffer()));
            loadedRomName = file.name;
            status.textContent = info.title + ' — ' + formatSize(info.bytes) +
                ' — cartridge type 0x' + info.cartridgeType.toString(16).padStart(2, '0').toUpperCase();
            if (runButton) runButton.disabled = false;
            if (resetButton) resetButton.disabled = false;
            startEmulation();
        } catch (error) {
            loadedRom = null;
            status.textContent = 'Could not load ROM: ' + error.message;
            status.classList.add('error');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseRomPicker);
} else {
    initialiseRomPicker();
}
