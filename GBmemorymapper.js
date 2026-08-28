// Cartridge loading and memory-bank controllers.
// The complete cartridge image. The CPU currently maps the first 32 KiB;
// future memory-bank-controller code can use this array for bank switching.
var loadedRom = null;
var activeRomBank = 1;
var activeRamBank = 0;
var mbc1UpperBits = 0;
var mbc1Mode = 0;
var mapperKind = 'ROM';
var cartridgeRamEnabled = false;
var cartridgeRam = new Uint8Array(0x20000);
var rawReadMem = readMem;
var rawWriteMem = writeMem;

var CARTRIDGE_TYPES = {
    0x00: ['ROM ONLY', 'ROM'],
    0x01: ['MBC1', 'MBC1'], 0x02: ['MBC1+RAM', 'MBC1'], 0x03: ['MBC1+RAM+BATTERY', 'MBC1'],
    0x05: ['MBC2', 'MBC2'], 0x06: ['MBC2+BATTERY', 'MBC2'],
    0x08: ['ROM+RAM', 'ROM_RAM'], 0x09: ['ROM+RAM+BATTERY', 'ROM_RAM'],
    0x0B: ['MMM01', 'MBC1'], 0x0C: ['MMM01+RAM', 'MBC1'], 0x0D: ['MMM01+RAM+BATTERY', 'MBC1'],
    0x0F: ['MBC3+TIMER+BATTERY', 'MBC3'], 0x10: ['MBC3+TIMER+RAM+BATTERY', 'MBC3'],
    0x11: ['MBC3', 'MBC3'], 0x12: ['MBC3+RAM', 'MBC3'], 0x13: ['MBC3+RAM+BATTERY', 'MBC3'],
    0x19: ['MBC5', 'MBC5'], 0x1A: ['MBC5+RAM', 'MBC5'], 0x1B: ['MBC5+RAM+BATTERY', 'MBC5'],
    0x1C: ['MBC5+RUMBLE', 'MBC5'], 0x1D: ['MBC5+RUMBLE+RAM', 'MBC5'],
    0x1E: ['MBC5+RUMBLE+RAM+BATTERY', 'MBC5'],
    0x20: ['MBC6', 'MBC5'], 0x22: ['MBC7+SENSOR+RUMBLE+RAM+BATTERY', 'MBC5'],
    0xFC: ['POCKET CAMERA', 'MBC5'], 0xFD: ['BANDAI TAMA5', 'MBC5'],
    0xFE: ['HuC3', 'MBC3'], 0xFF: ['HuC1+RAM+BATTERY', 'MBC1'],
};

function cartridgeRamSize(code, type) {
    if (type === 0x05 || type === 0x06) return 0x200;
    return ({ 0x00: 0, 0x01: 0x800, 0x02: 0x2000, 0x03: 0x8000,
        0x04: 0x20000, 0x05: 0x10000 })[code] || 0;
}
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
        if (mapperKind === 'MBC2') return 0xF0 | cartridgeRam[address & 0x1FF];
        if (mapperKind === 'MBC3' && activeRamBank > 3) return 0xFF; // RTC not implemented
        var ramBank = mapperKind === 'MBC1' && mbc1Mode ? mbc1UpperBits : activeRamBank;
        var ramOffset = ramBank * 0x2000 + address - 0xA000;
        return ramOffset < cartridgeRam.length ? cartridgeRam[ramOffset] : 0xFF;
    }
    if (address >= 0xE000 && address <= 0xFDFF) return memory[address - 0x2000];
    return rawReadMem(address);
};

writeMem = function(address, value) {
    address &= 0xFFFF;
    value &= 0xFF;
    if (loadedRom && address < 0x8000 && (mapperKind === 'ROM' || mapperKind === 'ROM_RAM')) return;
    if (loadedRom && mapperKind === 'MBC2' && address < 0x4000) {
        if (address & 0x0100) {
            activeRomBank = value & 0x0F;
            if (activeRomBank === 0) activeRomBank = 1;
        } else {
            cartridgeRamEnabled = (value & 0x0F) === 0x0A;
        }
        return;
    }
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
    if (loadedRom && mapperKind === 'MBC5' && address < 0x3000) {
        activeRomBank = (activeRomBank & 0x100) | value;
        return;
    }
    if (loadedRom && mapperKind === 'MBC5' && address < 0x4000) {
        activeRomBank = (activeRomBank & 0xFF) | ((value & 1) << 8);
        return;
    }
    if (loadedRom && address < 0x4000) {
        activeRomBank = mapperKind === 'MBC3' ? value & 0x7F : value & 0x1F;
        if (activeRomBank === 0) activeRomBank = 1;
        return;
    }
    if (loadedRom && address < 0x6000) {
        if (mapperKind === 'MBC3') activeRamBank = value;
        else if (mapperKind === 'MBC5') activeRamBank = value & 0x0F;
        else mbc1UpperBits = value & 0x03;
        return;
    }
    if (loadedRom && address < 0x8000) {
        if (mapperKind === 'MBC1') mbc1Mode = value & 1;
        return;
    }
    if (address >= 0xA000 && address <= 0xBFFF && cartridgeRamEnabled) {
        if (mapperKind === 'MBC2') {
            cartridgeRam[address & 0x1FF] = value & 0x0F;
            return;
        }
        if (mapperKind === 'MBC3' && activeRamBank > 3) return; // RTC not implemented
        var ramBank = mapperKind === 'MBC1' && mbc1Mode ? mbc1UpperBits : activeRamBank;
        var ramOffset = ramBank * 0x2000 + address - 0xA000;
        if (ramOffset < cartridgeRam.length) cartridgeRam[ramOffset] = value;
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

function cartridgeTitle(rom) {
    var chars = [];
    for (var i = 0x134; i <= 0x143 && i < rom.length; i++) {
        if (rom[i] === 0) break;
        if (rom[i] >= 0x20 && rom[i] <= 0x7E) chars.push(String.fromCharCode(rom[i]));
    }
    return chars.join('').trim() || 'Untitled cartridge';
}
function loadRomBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('ROM data must be a Uint8Array.');
    if (bytes.length < 0x150) throw new Error('This file is too small to contain a Game Boy cartridge header.');

    loadedRom = new Uint8Array(bytes);
    var cartridgeType = loadedRom[0x147];
    var typeInfo = CARTRIDGE_TYPES[cartridgeType] || ['UNKNOWN', 'ROM'];
    mapperKind = typeInfo[1];
    activeRomBank = 1;
    activeRamBank = 0;
    mbc1UpperBits = 0;
    mbc1Mode = 0;
    cartridgeRamEnabled = false;
    cartridgeRam = new Uint8Array(cartridgeRamSize(loadedRom[0x149], cartridgeType));
    cartridgeRamEnabled = mapperKind === 'ROM_RAM';
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
        cartridgeTypeName: typeInfo[0],
        mapper: mapperKind,
    };
}
