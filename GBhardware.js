// Game Boy timers, video, audio, and input hardware.
var statusElement = null;
var canvasContext = null;
var frameImage = null;
var backgroundColourIds = new Uint8Array(160 * 144);
var scanlineScrollX = new Uint8Array(144);
var scanlineScrollY = new Uint8Array(144);
var joypadButtons = 0xFF;
var dividerCycleAccumulator = 0;
var timerCycleAccumulator = 0;
var gameBoyApu = null;
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
