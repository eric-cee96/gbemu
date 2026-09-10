# gbemu

**gbemu** is a HTML5 Javascript Gameboy Emulator, currently in development.

TODO:
- [x] Add a Opcode decoder
	- [x] Implement a virtual Gameboy Processor
	- [ ] Debug the decoder/processor
- [ ] Hardware emulation
- [x] Memory Mapper
- [ ] Cartrige Reader
- [ ] Add HTML5 Canvas Screen output.
- [ ] Make Mobile compatible.
	- [ ] Implement the Gamepad API
- [ ] Test compatibility for different ROM's.

## Opcode tests

Install a current Node.js release and run:

```text
npm test
```

On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd test` or
`node tests/opcodes.test.js`.

The table-driven tests in `tests/opcodes.test.js` execute `LR35902.js` in an
isolated VM for every case and check registers, flags, memory, program-counter
movement, stack behavior, and cycle counts.

## Source layout

- `LR35902.js` — CPU state and opcode decoder
- `GBmemorymapper.js` — ROM loading and cartridge mappers
- `GBhardware.js` — timers, graphics, audio, and controls
- `GBprocessor.js` — interrupts and CPU/frame scheduling
- `main.js` — browser UI and startup

## Super Mario Land 2 compatibility

Tested the USA/Europe Rev 2 ROM (MARIOLAND2, 512 KiB, MBC1+RAM+BATTERY)
through the title screen, file selection, and the opening level using a
1,200-frame headless session with Start, Right, and A input. This is a smoke
test, not a full playthrough or audio validation. Battery saves are not persisted.

The compatibility fixes route LD A,(a16) through the memory bus and suppress
LCD/VBlank interrupts while the LCD is disabled.

Run the reproducible smoke test with your own ROM (no ROM is included):

```text
node tools/smoke-rom.js "path/to/game.gb" "path/to/captures"
```

The optional capture directory receives BMP screenshots. The script checks
for rendered, changing graphics and reports execution errors; its button
sequence is intended for Super Mario Land 2.

## License

Required Notice: Copyright (c) 2026 Eric Cee

The project code is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Copyright remains with its respective authors. Use, modification, and redistribution are permitted for the purposes defined in the license. Commercial use is not licensed; it requires separate permission from the copyright holder. Retain the required copyright notice and license terms when sharing the code.

This is a noncommercial source-available license, not an OSI-approved open-source license. ROMs, game assets, and third-party dependencies remain subject to their own licenses.
