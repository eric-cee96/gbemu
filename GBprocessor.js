// CPU scheduling, interrupts, and frame execution.
var emulationRunning = false;
var animationFrameId = null;
var clockSpeed = 1;
var speedAccumulator = 0;
var CYCLES_PER_FRAME = 70224;
var FRAME_CYCLE_LIMIT = CYCLES_PER_FRAME * 2;
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
