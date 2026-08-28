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
