
var memory = new Uint8Array(0x10000);

var reg = new Array(6);

const A = 0;
const F = 1;

const B = 2;
const C = 3;

const D = 4;
const E = 5;

const H = 6;
const L = 7;

const AF = 0;
const BC = 1;
const DE = 2;
const HL = 3;
const SP = 4;
const PC = 5;

const _Z = 7;
const _N = 6;
const _H = 5;
const _C = 4;

reg[AF] = 0x01B0;
reg[BC] = 0x0013;
reg[DE] = 0x00D8;
reg[HL] = 0x014D;
reg[SP] = 0xFFFE;
reg[PC] = 0x0100;

var halting = false;
var stopping = false;
var IME = true;


var notImplemented = function(code) {
    console.log("0x"+code.toString(16) + " opcode not implemented.");
    return "Not implemented.";
}

var decode = new Array(0x100);
var CBdecode = new Array(0x100);

for(let i = 0; i < 0x100; i++){
    decode[i] = function() { return notImplemented(i); }
    CBdecode[i] = function() { return notImplemented(i); }
}


var getByteRegister = function(r1) {
    var r16 = Math.floor(r1 / 2);
    var hl = r1 % 2;
    var rb = reg[r16];
    var rh = (rb & 0xFF00)>>8;
    var rl = (rb & 0xFF);
    
    if(hl==0) return rh;
    else return rl;
}

var setByteRegister = function(r1, val) {
    var r16 = Math.floor(r1 / 2);
    var hl = r1 % 2;
    
    var rb = reg[r16];
    var rh = (rb & 0xFF00)>>8;
    var rl = (rb & 0xFF);
    
    val &= 0xFF;
    if(hl == 0) rh = val;
    else rl = r1 === F ? val & 0xF0 : val;
    
    reg[r16] = (rh << 8) | rl;
}

var writeMem = function(addr, b) {
    memory[addr]=b;
}

var readMem = function(addr) {
    return memory[addr];
}

var setFlag = function(fl, o) {
    var flagreg = reg[AF]&0xFF;
    var areg = reg[AF]&0xFF00;
    if(o){
        flagreg |= 0x01 << fl;
    }
    else {
        flagreg &= ~(0x01 << fl)
    }
    reg[AF] = areg|flagreg;
}

var getFlag = function(fl){
    return (reg[AF] >> fl) & 0x01;
}

function uncomplement(val, bitwidth) {
    var isnegative = val & (1 << (bitwidth - 1));
    var boundary = (1 << bitwidth);
    var minval = -boundary;
    var mask = boundary - 1;
    return isnegative ? minval + (val & mask) : val;
}

function LDRN(r1) {
    reg[PC]++;
    var immediate = readMem(reg[PC]);
    reg[PC]++;
    setByteRegister(r1, immediate);
    return 8;
}

function LDRR(r1,r2){
    setByteRegister(r1, getByteRegister(r2));
    reg[PC]++;
    return 4;
}

function LDRD(r1, dr) {
    var addr = reg[dr];
    setByteRegister(r1, readMem(addr));
    reg[PC]++;
    return 8;
}

function LDRAD(r1) {
    reg[PC]++;
    var n1 = readMem(reg[PC]);
    reg[PC]++;
    var n2 = readMem(reg[PC]);
    var fus = (n2 << 8) | n1;
    setByteRegister(A, memory[fus]);
    reg[PC]++;
    return 16;
}

var LDWADR = function(w1, r1){
    writeMem(reg[w1], getByteRegister(r1));
    reg[PC]++;
    return 8;
}

var LDIADR = function(r1) {
    reg[PC]++;
    var n1 = readMem(reg[PC]);
    reg[PC]++;
    var n2 = readMem(reg[PC]);
    var fus = (n2 << 8) | n1;
    writeMem(fus, getByteRegister(r1));
    reg[PC]++;
    return 16;
}

var LDWADI = function(w1){
    reg[PC]++;
    var num = readMem(reg[PC]);
    reg[PC]++;
    writeMem(reg[w1], num);
    return 12;
}

var LDROR = function(r1, o1) {
    var vo1 = getByteRegister(o1);
    setByteRegister(r1, readMem(vo1+0xFF00));
    reg[PC]++;
    return 12;
}

var LDORR = function(o1, r1) {
    var rv = getByteRegister(r1);
    var ov = getByteRegister(o1);
    writeMem(0xFF00+ov, rv);
    reg[PC]++;
    return 12;
}

decode[0x00] = function() { // NOP
    reg[PC]++;
    return 4;
}

// LD nn,n (n=immediate value)

decode[0x06] = function() { // LD B,n
    return LDRN(B);
}
decode[0x0E] = function() { // LD C,n
    return LDRN(C);
}
decode[0x16] = function() { // LD D,n
    return LDRN(D);
}
decode[0x1e] = function() { // LD E,n
    return LDRN(E);
}
decode[0x26] = function() { // LD H,n
    return LDRN(H);
}
decode[0x2e] = function() { // LD L,n
    return LDRN(L);
}

// LD r1,r2 put value r1=r2

decode[0x7f] = function() { // LD A,A
    return LDRR(A, A);
}
decode[0x78] = function() { // LD A,B
    return LDRR(A, B);
}
decode[0x79] = function() { // LD A,C
    return LDRR(A, C);
}
decode[0x7A] = function() { // LD A,D
    return LDRR(A, D);
}
decode[0x7B] = function() { // LD A,E
    return LDRR(A, E);
}
decode[0x7C] = function() { // LD A,H
    return LDRR(A, H);
}
decode[0x7D] = function() { // LD A,L
    return LDRR(A, L);
}

decode[0x7E] = function() { // LD A,(HL)
    return LDRD(A, HL);
}
decode[0x0A] = function() { // LD A,(BC)
    return LDRD(A, BC);
}
decode[0x1A] = function() { // LD A,(DE)
    return LDRD(A, DE);
}
decode[0xFA] = function() { // LD A,(nn)
    return LDRAD(A);
}
decode[0x3E] = function() { // LD A,(#)
    return LDRN(A);
}

decode[0x02] = function() { // LD (BC),A
    return LDWADR(BC, A);
}
decode[0x12] = function() { // LD (DE),A
    return LDWADR(DE, A);
}
decode[0x77] = function() { // LD (HL),A
    return LDWADR(HL, A);
}
decode[0xEA] = function() { // LD (nn),A
    return LDIADR(A);
}

decode[0x40] = function() { // LD B,B
    return LDRR(B,B);
}
decode[0x41] = function() { // LD B,C
    return LDRR(B,C);
}
decode[0x42] = function() { // LD B,D
    return LDRR(B,D);
}
decode[0x43] = function() { // LD B,E
    return LDRR(B,E);
}
decode[0x44] = function() { // LD B,H
    return LDRR(B,H);
}
decode[0x45] = function() { // LD B,L
    return LDRR(B,L);
}
decode[0x46] = function() { // LD B,(HL)
    return LDRD(B,HL);
}

decode[0x48] = function() { // LD C,B
    return LDRR(C,B);
}
decode[0x49] = function() { // LD C,C
    return LDRR(C,C);
}
decode[0x4A] = function() { // LD C,D
    return LDRR(C,D);
}
decode[0x4B] = function() { // LD C,E
    return LDRR(C,E);
}
decode[0x4C] = function() { // LD C,H
    return LDRR(C,H);
}
decode[0x4D] = function() { // LD C,L
    return LDRR(C,L);
}
decode[0x4E] = function() { // LD C,(HL)
    return LDRD(C,HL);
}

decode[0x50] = function() { // LD D,B
    return LDRR(D,B);
}
decode[0x51] = function() { // LD D,C
    return LDRR(D,C);
}
decode[0x52] = function() { // LD D,D
    return LDRR(D,D);
}
decode[0x53] = function() { // LD D,E
    return LDRR(D,E);
}
decode[0x54] = function() { // LD D,H
    return LDRR(D,H);
}
decode[0x55] = function() { // LD D,L
    return LDRR(D,L);
}
decode[0x56] = function() { // LD D,(HL)
    return LDRD(D,HL);
}

decode[0x58] = function() { // LD E,B
    return LDRR(E,B);
}
decode[0x59] = function() { // LD E,C
    return LDRR(E,C);
}
decode[0x5A] = function() { // LD E,D
    return LDRR(E,D);
}
decode[0x5B] = function() { // LD E,E
    return LDRR(E,E);
}
decode[0x5C] = function() { // LD E,H
    return LDRR(E,H);
}
decode[0x5D] = function() { // LD E,L
    return LDRR(E,L);
}
decode[0x5E] = function() { // LD E,(HL)
    return LDRD(E,HL);
}

decode[0x60] = function() { // LD H,B
    return LDRR(H,B);
}
decode[0x61] = function() { // LD H,C
    return LDRR(H,C);
}
decode[0x62] = function() { // LD H,D
    return LDRR(H,D);
}
decode[0x63] = function() { // LD H,E
    return LDRR(H,E);
}
decode[0x64] = function() { // LD H,H
    return LDRR(H,H);
}
decode[0x65] = function() { // LD H,L
    return LDRR(H,L);
}
decode[0x66] = function() { // LD H,(HL)
    return LDRD(H,HL);
}

decode[0x68] = function() { // LD L,B
    return LDRR(L,B);
}
decode[0x69] = function() { // LD L,C
    return LDRR(L,C);
}
decode[0x6A] = function() { // LD L,D
    return LDRR(L,D);
}
decode[0x6B] = function() { // LD L,E
    return LDRR(L,E);
}
decode[0x6C] = function() { // LD L,H
    return LDRR(L,H);
}
decode[0x6D] = function() { // LD L,L
    return LDRR(L,L);
}
decode[0x6E] = function() { // LD L,(HL)
    return LDRD(L,HL);
}

decode[0x70] = function() { // LD (HL),B
    return LDWADR(HL,B);
}
decode[0x71] = function() { // LD (HL),C
    return LDWADR(HL,C);
}
decode[0x72] = function() { // LD (HL),D
    return LDWADR(HL,D);
}
decode[0x73] = function() { // LD (HL),E
    return LDWADR(HL,E);
}
decode[0x74] = function() { // LD (HL),H
    return LDWADR(HL,H);
}
decode[0x75] = function() { // LD (HL),L
    return LDWADR(HL,L);
}
decode[0x36] = function() { // LD (HL),n
    return LDWADI(HL);
}

decode[0xF2] = function() { // LD A,(C) 
    return LDROR(A, C);
}
decode[0xE2] = function() { // LD (C),A
    return LDORR(C, A);
}

decode[0x47] = function() { // LD B,A
    return LDRR(B,A);
} 
decode[0x4F] = function() { // LD C,A
    return LDRR(C,A);
} 
decode[0x57] = function() { // LD D,A
    return LDRR(D,A);
} 
decode[0x5F] = function() { // LD E,A
    return LDRR(E,A);
} 
decode[0x67] = function() { // LD H,A
    return LDRR(H,A);
} 
decode[0x6F] = function() { // LD L,A
    return LDRR(L,A);
} 

decode[0x3A] = function() { // LDD A,(HL)
    reg[PC]++;
    var hl = reg[HL];
    setByteRegister(A, readMem(hl));
    reg[HL] = (reg[HL] - 1) & 0xFFFF;
    return 8;
} 

decode[0x32] = function() { // LDD (HL),A
    reg[PC]++;
    var hl = reg[HL];
    writeMem(hl, getByteRegister(A));
    reg[HL] = (reg[HL] - 1) & 0xFFFF;
    return 8;
}

decode[0x2A] = function() { // LDI A,(HL)
    reg[PC]++;
    var hl = reg[HL];
    setByteRegister(A, readMem(hl));
    reg[HL] = (reg[HL] + 1) & 0xFFFF;
    return 8;
}

decode[0x22] = function() { // LDI (HL),A
    reg[PC]++;
    var hl = reg[HL];
    writeMem(hl, getByteRegister(A));
    reg[HL] = (reg[HL] + 1) & 0xFFFF;
    return 8;
}

decode[0xE0] = function() { // LDH (n),A
    reg[PC]++;
    var n = readMem(reg[PC]);
    writeMem(0xFF00+n, getByteRegister(A));
    reg[PC]++;
    return 12;
}

decode[0xF0] = function() { // LDH A,(n)
    reg[PC]++;
    var n = readMem(reg[PC]);
    setByteRegister(A, readMem(0xFF00+n));
    reg[PC]++;
    return 12;
}

function LDRWN(r16){
    reg[PC]++;
    var n1 = readMem(reg[PC]);
    reg[PC]++;
    var n2 = readMem(reg[PC]);
    var cv = (n2<<8)|n1;
    reg[r16] = cv;
    reg[PC]++;
    return 12;
}

decode[0x01] = function() { // LD BC,nn
    return LDRWN(BC);
}
decode[0x11] = function() { // LD DE,nn
    return LDRWN(DE);
}
decode[0x21] = function() { // LD HL,nn
    return LDRWN(HL);
}
decode[0x31] = function() { // LD SP,nn
    return LDRWN(SP);
}

decode[0xF9] = function() { // LD SP,HL
    reg[SP] = reg[HL];
    reg[PC]++;
    return 8;
}

decode[0xF8] = function() { // LDHL SP,n
    var n = uncomplement(readMem(reg[PC] + 1), 8);
    var sp = reg[SP];
    var unsigned = n & 0xFF;
    setFlag(_Z, 0);
    setFlag(_N, 0);
    setFlag(_H, ((sp & 0x0F) + (unsigned & 0x0F)) > 0x0F);
    setFlag(_C, ((sp & 0xFF) + unsigned) > 0xFF);
    reg[HL] = (sp + n) & 0xFFFF;
    reg[PC] += 2;
    return 12;
}

decode[0x08] = function() { // LD (nn),SP
    reg[PC]++;
    var n1 = readMem(reg[PC]);
    reg[PC]++;
    var n2 = readMem(reg[PC]);
    var cv = (n2<<8)|n1; 
    
    var n1sp = (reg[SP]&0xFF);
    var n2sp = (reg[SP]&0xFF00)>>8;
    
    
    writeMem(cv, n1sp);
    writeMem((cv+1)&0xFFFF, n2sp);
    reg[PC]++;
    
    return 20;
}

function gb_push(r16) {
    var re = reg[r16];
    reg[SP] = (reg[SP] - 1) & 0xFFFF;
    writeMem(reg[SP], (re >> 8) & 0xFF);
    reg[SP] = (reg[SP] - 1) & 0xFFFF;
    writeMem(reg[SP], re & 0xFF);
    reg[PC]++;
    return 16;
}

function gb_pop(r16) {
    var lo = readMem(reg[SP]);
    reg[SP] = (reg[SP] + 1) & 0xFFFF;
    var hi = readMem(reg[SP]);
    reg[SP] = (reg[SP] + 1) & 0xFFFF;
    reg[r16] = (hi<<8)|lo;
    if (r16 === AF) reg[AF] &= 0xFFF0;
    if (r16 !== PC) reg[PC]++;
    return 12;
}

// PUSH Instruction

decode[0xF5] = function() { // PUSH AF
    return gb_push(AF);
}
decode[0xC5] = function() { // PUSH BC
    return gb_push(BC);
}
decode[0xD5] = function() { // PUSH DE
    return gb_push(DE);
}
decode[0xE5] = function() { // PUSH HL
    return gb_push(HL);
}

// POP Instruction

decode[0xF1] = function() { // POP AF
    return gb_pop(AF);
}
decode[0xC1] = function() { // POP BC
    return gb_pop(BC);
}
decode[0xD1] = function() { // POP DE
    return gb_pop(DE);
}
decode[0xE1] = function() { // POP HL
    return gb_pop(HL);
}

// Arithmetic

// ADD

function addnn(n1,n2,carry,substract){
    var c = carry ? getFlag(_C) : 0;
    var res;
    if (substract) {
        res = n1 - n2 - c;
        setFlag(_N, 1);
        setFlag(_H, (n1 & 0x0F) < ((n2 & 0x0F) + c));
        setFlag(_C, n1 < n2 + c);
    } else {
        res = n1 + n2 + c;
        setFlag(_N, 0);
        setFlag(_H, ((n1 & 0x0F) + (n2 & 0x0F) + c) > 0x0F);
        setFlag(_C, res > 0xFF);
    }
    setFlag(_Z, (res & 0xFF) === 0);
    return res&0xFF;
}

function ADD(r1, r2, carry, substract){
    var n1 = getByteRegister(r1);
    var n2 = getByteRegister(r2);
    var c = getFlag(_C);
    var res = addnn(n1,n2,carry,substract);
    setByteRegister(r1, res);
    reg[PC]++;
    return 4;
}

function ADDAADR(carry,substract){
    var n1 = getByteRegister(A);
    var n2 = readMem(reg[HL]);
    var res = addnn(n1,n2,carry,substract);
    setByteRegister(A,res);
    reg[PC]++;
    return 8;
}

function ADDAN(carry,substract){
    var n1 = getByteRegister(A);
    reg[PC]++;
    var n2 = readMem(reg[PC]);
    var res = addnn(n1,n2,carry,substract);
    setByteRegister(A,res);
    reg[PC]++;
    return 8;
}

decode[0x87] = function() { // ADD A,A
    return ADD(A, A, false, false);
}
decode[0x80] = function() { // ADD A,B
    return ADD(A, B, false, false);
}
decode[0x81] = function() { // ADD A,C
    return ADD(A, C, false, false);
}
decode[0x82] = function() { // ADD A,D
    return ADD(A, D, false, false);
}
decode[0x83] = function() { // ADD A,E
    return ADD(A, E, false, false);
}
decode[0x84] = function() { // ADD A,H
    return ADD(A, H, false, false);
}
decode[0x85] = function() { // ADD A,L
    return ADD(A, L, false, false);
}
decode[0x86] = function() { // ADD A,(HL)
    return ADDAADR(false, false);
}
decode[0xC6] = function() { // ADD A,#
    return ADDAN(false, false);
}

// ADC

decode[0x8F] = function() { // ADC A,A
    return ADD(A, A, true, false);
}
decode[0x88] = function() { // ADC A,B
    return ADD(A, B, true, false);
}
decode[0x89] = function() { // ADC A,C
    return ADD(A, C, true, false);
}
decode[0x8A] = function() { // ADC A,D
    return ADD(A, D, true, false);
}
decode[0x8B] = function() { // ADC A,E
    return ADD(A, E, true, false);
}
decode[0x8C] = function() { // ADC A,H
    return ADD(A, H, true, false);
}
decode[0x8D] = function() { // ADC A,L
    return ADD(A, L, true, false);
}
decode[0x8E] = function() { // ADC A,(HL)
    return ADDAADR(true, false);
}
decode[0xCE] = function() { // AC A,#
    return ADDAN(true, false);
}

// SUB

decode[0x97] = function() { // SUB A,A
    return ADD(A, A, false, true);
}
decode[0x90] = function() { // SUB A,B
    return ADD(A, B, false, true);
}
decode[0x91] = function() { // SUB A,C
    return ADD(A, C, false, true);
}
decode[0x92] = function() { // SUB A,D
    return ADD(A, D, false, true);
}
decode[0x93] = function() { // SUB A,E
    return ADD(A, E, false, true);
}
decode[0x94] = function() { // SUB A,H
    return ADD(A, H, false, true);
}
decode[0x95] = function() { // SUB A,L
    return ADD(A, L, false, true);
}
decode[0x96] = function() { // SUB A,(HL)
    return ADDAADR(false, true);
}
decode[0xD6] = function() { // SUB A,#
    return ADDAN(false, true);
}

// SBC

decode[0x9F] = function() { // SBC A,A
    return ADD(A, A, true, true);
}
decode[0x98] = function() { // SBC A,B
    return ADD(A, B, true, true);
}
decode[0x99] = function() { // SBC A,C
    return ADD(A, C, true, true);
}
decode[0x9A] = function() { // SBC A,D
    return ADD(A, D, true, true);
}
decode[0x9B] = function() { // SBC A,E
    return ADD(A, E, true, true);
}
decode[0x9C] = function() { // SBC A,H
    return ADD(A, H, true, true);
}
decode[0x9D] = function() { // SBC A,L
    return ADD(A, L, true, true);
}
decode[0x9E] = function() { // SBC A,(HL)
    return ADDAADR(true, true);
}
decode[0xDE] = function() { // SBC A,#
    return ADDAN(true, true);
}

// AND

function setANDFlags(n){
    if(n==0) setFlag(_Z, 1);
    else setFlag(_Z, 0);
    setFlag(_N, 0);
    setFlag(_C, 0);
    setFlag(_H, 1);
}

function AND(r1) {
    var a = getByteRegister(A);
    var b = getByteRegister(r1);
    var res = (a&b)&0xFF;
    setANDFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 4;
}

decode[0xA7] = function() { // AND A
    return AND(A);
}
decode[0xA0] = function() { // AND B
    return AND(B);
}
decode[0xA1] = function() { // AND C
    return AND(C);
}
decode[0xA2] = function() { // AND D
    return AND(D);
}
decode[0xA3] = function() { // AND E
    return AND(E);
}
decode[0xA4] = function() { // AND H
    return AND(H);
}
decode[0xA5] = function() { // AND L
    return AND(L);
}

decode[0xA6] = function() { // AND (HL)
    var a = getByteRegister(A);
    var memb = readMem(reg[HL]);
    
    var res = (a&memb)&0xFF;
    
    setANDFlags(res);
    setByteRegister(A, res);
    
    reg[PC]++;
    return 8;
}

decode[0xE6] = function() { // AND #
    var a = getByteRegister(A);
    reg[PC]++;
    
    var memb = readMem(reg[PC]);
    
    var res = (a&memb)&0xFF;
    
    setANDFlags(res);
    setByteRegister(A, res);
    
    reg[PC]++;
    return 8;
}

// OR

function setORFlags(n) {
    if(n==0) setFlag(_Z, 1);
    else setFlag(_Z, 0);
    setFlag(_N, 0);
    setFlag(_C, 0);
    setFlag(_H, 0);
}

function OR(r1) {
    var a = getByteRegister(A);
    var b = getByteRegister(r1);
    var res = (a|b)&0xFF;
    setORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 4;
}

decode[0xB7] = function() { // OR A
    return OR(A);
}
decode[0xB0] = function() { // OR B
    return OR(B);
}
decode[0xB1] = function() { // OR C
    return OR(C);
}
decode[0xB2] = function() { // OR D
    return OR(D);
}
decode[0xB3] = function() { // OR E
    return OR(E);
}
decode[0xB4] = function() { // OR H
    return OR(H);
}
decode[0xB5] = function() { // OR L
    return OR(L);
}

decode[0xB6] = function() { // OR (HL)
    var a = getByteRegister(A);
    var n = readMem(reg[HL]);
    var res = (a|n)&0xFF;
    setORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 8;
}

decode[0xF6] = function() { // OR #
    reg[PC]++;
    var a = getByteRegister(A);
    var n = readMem(reg[PC]);
    var res = (a|n)&0xFF;
    setORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 8;
}

// XOR

function setXORFlags(n) {
    if(n==0) setFlag(_Z, 1);
    else setFlag(_Z, 0);
    setFlag(_N, 0);
    setFlag(_C, 0);
    setFlag(_H, 0);
}

function XOR(r1) {
    var a = getByteRegister(A);
    var b = getByteRegister(r1);
    var res = (a^b)&0xFF;
    setXORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 4;
}

decode[0xAF] = function() { // XOR A
    return XOR(A);
}
decode[0xA8] = function() { // XOR B
    return XOR(B);
}
decode[0xA9] = function() { // XOR C
    return XOR(C);
}
decode[0xAA] = function() { // XOR D
    return XOR(D);
}
decode[0xAB] = function() { // XOR E
    return XOR(E);
}
decode[0xAC] = function() { // XOR H
    return XOR(H);
}
decode[0xAD] = function() { // XOR L
    return XOR(L);
}

decode[0xAE] = function() { // XOR (HL)
    var a = getByteRegister(A);
    var n = readMem(reg[HL]);
    var res = (a^n)&0xFF;
    setORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 8;
}
decode[0xEE] = function() { // XOR #
    reg[PC]++;
    var a = getByteRegister(A);
    var n = readMem(reg[PC]);
    var res = (a^n)&0xFF;
    setORFlags(res);
    setByteRegister(A, res);
    reg[PC]++;
    return 8;
}

// CP

function compare(num){
    
    if(num==0){
        setFlag(_Z, 1);
        setFlag(_C, 0);
    }
    else{
        setFlag(_Z, 0);
        if(num<0){
            setFlag(_C, 1);
        }
        else {
            setFlag(_C, 0);
        }
    }
}

function CPab(a,b){
    var res = a-b;
    setFlag(_N, 1);
    setFlag(_H, (a & 0x0F) < (b & 0x0F));
    setFlag(_Z, (res & 0xFF) === 0);
    setFlag(_C, a < b);
}

function CPr(r1) {
    var a = getByteRegister(A);
    var b = getByteRegister(r1)&0xFF;
    
    CPab(a,b);
    reg[PC]++;
    
    return 4;
}

function CPhl(){
    var a = getByteRegister(A);
    var b = readMem(reg[HL]);
    CPab(a,b);
    reg[PC]++;
    return 8;
}

function CPn(){
    var a = getByteRegister(A);
    reg[PC]++;
    var b = readMem(reg[PC]);
    CPab(a,b);
    reg[PC]++;
    return 8;
}

decode[0xBF] = function() { // CP A
    return CPr(A);
}
decode[0xB8] = function() { // CP B
    return CPr(B);
}
decode[0xB9] = function() { // CP C
    return CPr(C);
}
decode[0xBA] = function() { // CP D
    return CPr(D);
}
decode[0xBB] = function() { // CP E
    return CPr(E);
}
decode[0xBC] = function() { // CP H
    return CPr(H);
}
decode[0xBD] = function() { // CP L
    return CPr(L);
}
decode[0xBE] = function() { // CP (HL)
    return CPhl();
}
decode[0xFE] = function() { // CP #
    return CPn();
}

// INC

function setIncFlags(val, i) {
    var result = val+i;
    setFlag(_H, !!(((val&0x0F) +i) & 0x10))
    setFlag(_N, i == -1)
    setFlag(_Z, ((result & 0xff) == 0))
}

function incr(r1,i){
    var x = getByteRegister(r1);
    setIncFlags(x,i);
    var res = x+i;
    setByteRegister(r1, res&0xFF);
    reg[PC]++;
    return 4;
}

function inchl(i){
    var x = readMem(reg[HL]);
    setIncFlags(x,i);
    var res = x+i;
    writeMem(reg[HL], res&0xFF);
    reg[PC]++;
    return 12;
}

decode[0x3C] = function() { // INC A
    return incr(A,1);
}
decode[0x04] = function() { // INC B
    return incr(B,1);
}
decode[0x0C] = function() { // INC C
    return incr(C,1);
}
decode[0x14] = function() { // INC D
    return incr(D,1);
}
decode[0x1C] = function() { // INC E
    return incr(E,1);
}
decode[0x24] = function() { // INC H
    return incr(H,1);
}
decode[0x2C] = function() { // INC L
    return incr(L,1);
}
decode[0x34] = function() { // INC (HL)
    return inchl(1);
}

// DEC

decode[0x3D] = function() { // DEC A
    return incr(A,-1);
}
decode[0x05] = function() { // DEC B
    return incr(B,-1);
}
decode[0x0D] = function() { // DEC C
    return incr(C,-1);
}
decode[0x15] = function() { // DEC D
    return incr(D,-1);
}
decode[0x1D] = function() { // DEC E
    return incr(E,-1);
}
decode[0x25] = function() { // DEC H
    return incr(H,-1);
}
decode[0x2D] = function() { // DEC L
    return incr(L,-1);
}
decode[0x35] = function() { // DEC (HL)
    return inchl(-1);
}

// ADD HL,n

function setADD16Flags(n,b){
    var res = n+b;
    setFlag(_C, res > 0xFFFF);
    setFlag(_H, ((n & 0x0FFF) + (b & 0x0FFF)) > 0x0FFF);
    return res&0xFFFF;
}

function ADD16(r16){
    var a = reg[HL];
    var b = reg[r16];
    
    var res = setADD16Flags(a,b);
    reg[HL] = res;
    reg[PC]++;
    setFlag(_N,0);
    return 8;
}

function ADD16N(r16, n){
    var a = reg[r16];
    var b = n;
    reg[r16] = setADD16Flags(a,b);
}

decode[0x09] = function() { // ADD HL,BC
    return ADD16(BC);
}
decode[0x19] = function() { // ADD HL,DE
    return ADD16(DE);
}
decode[0x29] = function() { // ADD HL,HL
    return ADD16(HL);
}
decode[0x39] = function() { // ADD HL,SP
    return ADD16(SP);
}

// ADD SP,n

decode[0xE8] = function() {
    var n = uncomplement(readMem(reg[PC] + 1), 8);
    var sp = reg[SP];
    var unsigned = n & 0xFF;
    setFlag(_Z, 0);
    setFlag(_N, 0);
    setFlag(_H, ((sp & 0x0F) + (unsigned & 0x0F)) > 0x0F);
    setFlag(_C, ((sp & 0xFF) + unsigned) > 0xFF);
    reg[SP] = (sp + n) & 0xFFFF;
    reg[PC] += 2;
    return 16;
}

// INC nn

decode[0x03] = function() { // INC BC
    reg[BC]++;
    reg[BC]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x13] = function() { // INC DE
    reg[DE]++;
    reg[DE]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x23] = function() { // INC HL
    reg[HL]++;
    reg[HL]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x33] = function() { // INC SP
    reg[SP]++;
    reg[SP]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}

// DEC nn

decode[0x0B] = function() { // DEC BC
    reg[BC]--;
    reg[BC]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x1B] = function() { // DEC DE
    reg[DE]--;
    reg[DE]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x2B] = function() { // DEC HL
    reg[HL]--;
    reg[HL]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}
decode[0x3B] = function() { // DEC SP
    reg[SP]--;
    reg[SP]&=0xFFFF;
    
    reg[PC]++;
    return 8;
}

// DAA

decode[0x27] = function() {
    var n = getFlag(_N);
    var c = getFlag(_C);
    var h = getFlag(_H);
    var a = getByteRegister(A);
    var correction = 0;
    if (n) {
        if (c) correction |= 0x60;
        if (h) correction |= 0x06;
        a = (a - correction) & 0xFF;
    } else {
        if (c || a > 0x99) { correction |= 0x60; c = 1; }
        if (h || (a & 0x0F) > 0x09) correction |= 0x06;
        a = (a + correction) & 0xFF;
    }
    setByteRegister(A, a);
    setFlag(_C, c);
    setFlag(_H, 0);
    setFlag(_Z, a === 0);
    reg[PC]++;
    return 4;
}

// CPL

decode[0x2F] = function() {
    setFlag(_N, 1);
    setFlag(_H, 1);
    
    var xinv = getByteRegister(A);
    xinv = ~xinv;
    setByteRegister(A, xinv);
    
    reg[PC]++;
    return 4;
}

// CCF

decode[0x3F] = function() {
    setFlag(_N, 0);
    setFlag(_H, 0);
    setFlag(_C, getFlag(_C)==0?1:0);
    reg[PC]++;
    return 4;
}

// SCF

decode[0x37] = function() {
    setFlag(_N, 0);
    setFlag(_H, 0);
    setFlag(_C, 1);
    reg[PC]++;
    return 4;
}

// HALT

decode[0x76] = function() {
    halting = true;
    reg[PC]++;
    return 4;
}

// STOP

decode[0x10] = function() {
    stopping = true;
    reg[PC]+=2;
    return 4;
}

// DI

decode[0xF3] = function() {
    IME = false;
    reg[PC]++;
    return 4;
}

// EI

decode[0xFB] = function() {
    IME = true;
    reg[PC]++;
    return 4;
}

// RLCA

decode[0x07] = function() {
    var old = getByteRegister(A);
    var obs = old >> 7;
    setFlag(_C, obs);
    var a = ((old << 1) | obs) & 0xFF;
    setByteRegister(A, a);
    setFlag(_Z, 0);
    setFlag(_H, 0);
    setFlag(_N, 0);
    reg[PC]++;
    return 4;
}

// RLA

decode[0x17] = function() {
    var old = getByteRegister(A);
    var carry = getFlag(_C);
    setFlag(_C, old >> 7);
    var a = ((old << 1) | carry) & 0xFF;
    setByteRegister(A, a);
    setFlag(_Z, 0);
    setFlag(_H, 0);
    setFlag(_N, 0);
    reg[PC]++;
    return 4;
}

// RRCA

decode[0x0F] = function() {
    var old = getByteRegister(A);
    var obz = old & 1;
    setFlag(_C, obz);
    var a = (old >> 1) | (obz << 7);
    setByteRegister(A, a);
    setFlag(_Z, 0);
    
    setFlag(_H, 0);
    setFlag(_N, 0);
    
    reg[PC]++;
    return 4;
}

// RRA

decode[0x1F] = function() {
    var old = getByteRegister(A);
    var carry = getFlag(_C);
    var obz = old & 1;
    setFlag(_C, obz);
    var a = (old >> 1) | (carry << 7);
    setByteRegister(A, a);
    setFlag(_Z, 0);
    
    setFlag(_H, 0);
    setFlag(_N, 0);
    
    reg[PC]++;
    return 4;
}

// Jumps Page 111

// JP nn

decode[0xC3] = function() { // JP
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    var addr = n2<<8|n1;
    
    reg[PC]=addr;
    return 12;
}

// JP cc,nn

decode[0xC2] = function() { // NZ
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    if(getFlag(_Z)==0){
        var addr = n2<<8|n1;
        reg[PC]=addr;
    }
    else {
        reg[PC]++;
    }
    return reg[PC] === ((n2<<8)|n1) ? 16 : 12;
}
decode[0xCA] = function() { // Z
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    if(getFlag(_Z)==1){
        var addr = n2<<8|n1;
        reg[PC]=addr;
    }
    else {
        reg[PC]++;
    }
    return reg[PC] === ((n2<<8)|n1) ? 16 : 12;
}
decode[0xD2] = function() { // NC
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    if(getFlag(_C)==0){
        var addr = n2<<8|n1;
        reg[PC]=addr;
    }
    else {
        reg[PC]++;
    }
    return reg[PC] === ((n2<<8)|n1) ? 16 : 12;
}
decode[0xDA] = function() { // C
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    if(getFlag(_C)==1){
        var addr = n2<<8|n1;
        reg[PC]=addr;
    }
    else {
        reg[PC]++;
    }
    return reg[PC] === ((n2<<8)|n1) ? 16 : 12;
}

// JP (HL)

decode[0xE9] = function() {
    reg[PC]=reg[HL];
    
    return 4;
}

// JR n

decode[0x18] = function() {
    var n = uncomplement(readMem(reg[PC]+1),8);
    reg[PC]=(reg[PC]+2+n)&0xFFFF;
    return 12;
}

// JR cc,n

decode[0x20] = function() { // JR NZ,n
    if(getFlag(_Z)!=1){
        var n = uncomplement(readMem(reg[PC]+1),8);
        reg[PC]=(reg[PC]+2+n)&0xFFFF;
        return 12;
    }
    else {
        reg[PC]+=2;
        return 8;
    }
}
decode[0x28] = function() { // JR Z,n
    if(getFlag(_Z)==1){
        var n = uncomplement(readMem(reg[PC]+1),8);
        reg[PC]=(reg[PC]+2+n)&0xFFFF;
        return 12;
    }
    else {
        reg[PC]+=2;
        return 8;
    }
}
decode[0x30] = function() { // JR NC,n
    if(getFlag(_C)!=1){
        var n = uncomplement(readMem(reg[PC]+1),8);
        reg[PC]=(reg[PC]+2+n)&0xFFFF;
        return 12;
    }
    else {
        reg[PC]+=2;
        return 8;
    }
}
decode[0x38] = function() { // JR C,n
    if(getFlag(_C)==1){
        var n = uncomplement(readMem(reg[PC]+1),8);
        reg[PC]=(reg[PC]+2+n)&0xFFFF;
        return 12;
    }
    else {
        reg[PC]+=2;
        return 8;
    }
}

// Calls

// CALL nn

decode[0xCD] = function() {
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    gb_push(PC);
    reg[PC]=n2<<8|n1;
    return 12;
}

// CALL cc,nn

decode[0xC4] = function() { // NZ
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    
    if(getFlag(_Z)==1){
        gb_push(PC);
        reg[PC]=n2<<8|n1;
        return 12;
    }
    
    reg[PC]++;
    return 12;
}

decode[0xCC] = function() { // Z
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    
    if(getFlag(_Z)==0){
        gb_push(PC);
        reg[PC]=n2<<8|n1;
        return 12;
    }
    
    reg[PC]++;
    return 12;
}

decode[0xD4] = function() { // NC
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    
    if(getFlag(_C)==1){
        gb_push(PC);
        reg[PC]=n2<<8|n1;
        return 12;
    }
    
    reg[PC]++;
    return 12;
}

decode[0xDC] = function() { // C
    var n1 = readMem(++reg[PC]);
    var n2 = readMem(++reg[PC]);
    
    if(getFlag(_C)==0){
        gb_push(PC);
        reg[PC]=n2<<8|n1;
        return 12;
    }
    
    reg[PC]++;
    return 12;
}

// RST n

decode[0xC7] = function() { // 0x00
    gb_push(reg[PC]+1);
    reg[PC] = 0x00;
    return 32;
}

decode[0xCF] = function() { // 0x08
    gb_push(reg[PC]+1);
    reg[PC] = 0x08;
    return 32;
}

decode[0xD7] = function() { // 0x10
    gb_push(reg[PC]+1);
    reg[PC] = 0x10;
    return 32;
}

decode[0xDF] = function() { // 0x18
    gb_push(reg[PC]+1);
    reg[PC] = 0x18;
    return 32;
}

decode[0xE7] = function() { // 0x20
    gb_push(reg[PC]+1);
    reg[PC] = 0x20;
    return 32;
}

decode[0xEF] = function() { // 0x28
    gb_push(reg[PC]+1);
    reg[PC] = 0x28;
    return 32;
}

decode[0xF7] = function() { // 0x30
    gb_push(reg[PC]+1);
    reg[PC] = 0x30;
    return 32;
}

decode[0xFF] = function() { // 0x38
    gb_push(reg[PC]+1);
    reg[PC] = 0x38;
    return 32;
}

// RET

decode[0xC9] = function() {
    gb_pop(PC);
    return 8;
}

// RET cc

decode[0xC0] = function() { // NZ
    if(getFlag(_Z)==1){
        gb_pop(PC);
        return 8;
    }
    else {
        reg[PC]++;
        return 8;
    }
}
decode[0xC8] = function() { // Z
    if(getFlag(_Z)==0){
        gb_pop(PC);
        return 8;
    }
    else {
        reg[PC]++;
        return 8;
    }
}
decode[0xD0] = function() { // NC
    if(getFlag(_C)==1){
        gb_pop(PC);
        return 8;
    }
    else {
        reg[PC]++;
        return 8;
    }
}
decode[0xD8] = function() { // C
    if(getFlag(_C)==0){
        gb_pop(PC);
        return 8;
    }
    else {
        reg[PC]++;
        return 8;
    }
}

// RETI

decode[0xD9] = function() {
    gb_pop(PC);
    IME = true;
    return 8;
}

// Prefix CB implementation

const rhl = 10; // HL register indicator

function RLC(r8){
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
		if(r8==rhl){
			var v = readMem(reg[HL]);
            var b = v&(0x01<<7);
            v=((v<<1)&0xFF)|b;
            setFlag(_C, b);
            setFlag(_Z, v==0?0:1);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v&(0x01<<7);
            v=((v<<1)&0xFF)|b;
            setFlag(_C, b);
            setFlag(_Z, v==0?0:1);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function RRC(r8){
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            var b = v&(0x01<<7);
            v= (v>>1) | b;
            setFlag(_C, b);
            setFlag(_Z, v==0?0:1);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v&(0x01);
            v= (v>>1) | b;
            setFlag(_C, b);
            setFlag(_Z, v==0?0:1);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function RL(r8) {
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            var b = v&(0x01<<7);
            setFlag(_C, b==0?0:1);
            v = v<<1;
            setFlag(_Z, v==0?0:1);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v&(0x01<<7);
            setFlag(_C, b==0?0:1);
            v = v<<1;
            setFlag(_Z, v==0?0:1);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function RR(r8) {
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            var b = v&(0x01);
            setFlag(_C, b==0?0:1);
            v = v>>1;
            setFlag(_Z, v==0?0:1);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v&(0x01);
            setFlag(_C, b==0?0:1);
            v = v>>1;
            setFlag(_Z, v==0?0:1);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function SLA(r8) {
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            v = (v<<1)&0xFF;
            setFlag(_Z, v == 0?0:1);
            setFlag(_C, b==0?0:1);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v & (0x01 << 8);
            v = (v<<1)&0xFF;
            setFlag(_Z, v == 0?0:1);
            setFlag(_C, b==0?0:1);
            return 8;
		}
	}
}

function SRA(r8) {
	return function(){
        reg[PC]++;
        setFlag(_H, 0);
        setFlag(_N, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            var b = v & 0x01;
            v = (v >> 1) | (b<<7);
            setFlag(_Z, v == 0?0:1);
            setFlag(_C, b == 0?0:1);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            var b = v & 0x01;
            v = (v >> 1) | (b<<7);
            setFlag(_Z, v == 0?0:1);
            setFlag(_C, b == 0?0:1);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function SWAP(r8) {
	return function(){
		reg[PC]++;
        setFlag(_N, 0);
        setFlag(_H, 0);
        setFlag(_C, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
			v = ((v<<4)&0xFF | (v&0xF0)>>4);
            setFlag(_Z, v == 0?0:1);
			writeMem(reg[HL],v);
			return 16;
		}
		else{
			var v = getByteRegister(r8);
            console.log(v.toString(16))
			v = ((v<<4)&0xFF | (v&0xF0)>>4);
            console.log(v.toString(16))
            setFlag(_Z, v == 0);
			setByteRegister(r8, v);
			return 8;
		}
	}
}

function SRL(r8){
	return function(){
        reg[PC]++;
        setFlag(_N, 0);
        setFlag(_H, 0);
        
		if(r8==rhl){
			var v = readMem(reg[HL]);
            setFlag(_C, v&0x01?0:1);
            v = v>>1;
            setFlag(_Z, v==0);
            writeMem(reg[HL], v);
            return 16;
		}
		else{
			var v = getByteRegister(r8);
            setFlag(_C, v&0x01?0:1);
            v = v>>1;
            setFlag(_Z, v==0);
            setByteRegister(r8, v);
            return 8;
		}
	}
}

function BIT(n, r8){
	return function(){
		
		var b = readMem(++reg[PC]);
		setFlag(_N, 0);
		setFlag(_H, 1);
		reg[PC]++;
		if(r8==rhl){
			var v = readMem(reg[HL]);
			setFlag(_Z, v&(0x01<<b));
			return 16;
		}
		else {
			var v = getByteRegister(r8);
			setFlag(_Z, v&(0x01<<b));
			return 8;
		}
	}
}

function RES(n, r8) {
	return function(){
		reg[PC]++;
		var b = readMem(++reg[PC]);
		if(r8==rhl){
			var v = readMem(reg[HL]);
			writeMem(reg[HL], v&(~(0x01<<b)));
			return 16;
		}
		else {
			var v = getByteRegister(r8);
			setByteRegister(r8, v&(~(0x01<<b)));
			return 8;
		}
	}
}

function SET(n, r8) {
	return function(){
		reg[PC]++;
		var b = readMem(++reg[PC]);
		if(r8==rhl){
			var v = readMem(reg[HL]);
			writeMem(reg[HL], v|(0x01<<b));
			return 16;
		}
		else {
			var v = getByteRegister(r8);
			setByteRegister(r8, v|(0x01<<b));
			return 8;
		}
	}
}



var seq = [B,C,D,E,H,L,rhl,A]; // CB Codes sequence registers
var seqf = ["RLC","RRC","RL","RR","SLA","SRA","SWAP","SRL"];
var ssqf = ["BIT","RES","SET"];
var cbp = 0;

for(var f = 0; f < seqf.length; f++){
    for(var r = 0; r < seq.length; r++){
        switch(seqf[f]){
            case "RLC": CBdecode[cbp]=RLC(seq[r]); break;
            case "RRC": CBdecode[cbp]=RRC(seq[r]); break;
            case "RL": CBdecode[cbp]=RL(seq[r]); break;
            case "RR": CBdecode[cbp]=RR(seq[r]); break;
            case "SLA": CBdecode[cbp]=SLA(seq[r]); break;
            case "SRA": CBdecode[cbp]=SRA(seq[r]); break;
            case "SWAP": CBdecode[cbp]=SWAP(seq[r]); break;
            case "SRL": CBdecode[cbp]=SRL(seq[r]); break;
        }
        cbp++;
    }
}

for(var f = 0; f < ssqf.length; f++){
    for(var r = 0; r < seq.length; r++){
        for(var b = 0; b < 8; b++){
            switch(ssqf[f]){
                case "BIT": CBdecode[cbp]=BIT(seq[r], b); break;
                case "RES": CBdecode[cbp]=RES(seq[r], b); break;
                case "SET": CBdecode[cbp]=SET(seq[r], b); break;
            }
            cbp++;
        }
    }
}

decode[0xCB] = function() {
    reg[PC]++;
    var cbcode = readMem(reg[PC]);
    return CBdecode[cbcode]();
}


// End Prefix CB

// Correct LR35902 CB decoder. The original helpers above are retained for
// compatibility, but this table is authoritative and follows the opcode's
// x/y/z bit fields directly.
function cbRead(z) {
    var ids = [B, C, D, E, H, L, null, A];
    return z === 6 ? readMem(reg[HL]) : getByteRegister(ids[z]);
}

function cbWrite(z, value) {
    var ids = [B, C, D, E, H, L, null, A];
    value &= 0xFF;
    if (z === 6) writeMem(reg[HL], value);
    else setByteRegister(ids[z], value);
}

for (let opcode = 0; opcode < 0x100; opcode++) {
    CBdecode[opcode] = function() {
        var x = opcode >> 6;
        var y = (opcode >> 3) & 7;
        var z = opcode & 7;
        var value = cbRead(z);
        var result = value;

        if (x === 0) {
            var oldCarry = getFlag(_C);
            var carry;
            switch (y) {
                case 0: // RLC
                    carry = value >> 7;
                    result = ((value << 1) | carry) & 0xFF;
                    break;
                case 1: // RRC
                    carry = value & 1;
                    result = (value >> 1) | (carry << 7);
                    break;
                case 2: // RL
                    carry = value >> 7;
                    result = ((value << 1) | oldCarry) & 0xFF;
                    break;
                case 3: // RR
                    carry = value & 1;
                    result = (value >> 1) | (oldCarry << 7);
                    break;
                case 4: // SLA
                    carry = value >> 7;
                    result = (value << 1) & 0xFF;
                    break;
                case 5: // SRA
                    carry = value & 1;
                    result = (value >> 1) | (value & 0x80);
                    break;
                case 6: // SWAP
                    carry = 0;
                    result = ((value << 4) | (value >> 4)) & 0xFF;
                    break;
                case 7: // SRL
                    carry = value & 1;
                    result = value >> 1;
                    break;
            }
            cbWrite(z, result);
            setFlag(_Z, result === 0);
            setFlag(_N, 0);
            setFlag(_H, 0);
            setFlag(_C, carry);
        } else if (x === 1) { // BIT y,r
            setFlag(_Z, (value & (1 << y)) === 0);
            setFlag(_N, 0);
            setFlag(_H, 1);
        } else if (x === 2) { // RES y,r
            cbWrite(z, value & ~(1 << y));
        } else { // SET y,r
            cbWrite(z, value | (1 << y));
        }

        reg[PC]++;
        if (z !== 6) return 8;
        return x === 1 ? 12 : 16;
    };
}

decode[0xCB] = function() {
    reg[PC]++;
    return CBdecode[readMem(reg[PC])]();
};

function pushWord(value) {
    reg[SP] = (reg[SP] - 1) & 0xFFFF;
    writeMem(reg[SP], (value >> 8) & 0xFF);
    reg[SP] = (reg[SP] - 1) & 0xFFFF;
    writeMem(reg[SP], value & 0xFF);
}

function popWord() {
    var lo = readMem(reg[SP]);
    reg[SP] = (reg[SP] + 1) & 0xFFFF;
    var hi = readMem(reg[SP]);
    reg[SP] = (reg[SP] + 1) & 0xFFFF;
    return (hi << 8) | lo;
}

decode[0xC3] = function() { // JP a16
    reg[PC] = readMem(reg[PC] + 1) | (readMem(reg[PC] + 2) << 8);
    return 16;
};

[[0xC2, _Z, 0], [0xCA, _Z, 1], [0xD2, _C, 0], [0xDA, _C, 1]].forEach(function(entry) {
    decode[entry[0]] = function() {
        var target = readMem(reg[PC] + 1) | (readMem(reg[PC] + 2) << 8);
        if (getFlag(entry[1]) === entry[2]) {
            reg[PC] = target;
            return 16;
        }
        reg[PC] += 3;
        return 12;
    };
});

decode[0xCD] = function() { // CALL a16
    var target = readMem(reg[PC] + 1) | (readMem(reg[PC] + 2) << 8);
    pushWord((reg[PC] + 3) & 0xFFFF);
    reg[PC] = target;
    return 24;
};

[[0xC4, _Z, 0], [0xCC, _Z, 1], [0xD4, _C, 0], [0xDC, _C, 1]].forEach(function(entry) {
    decode[entry[0]] = function() {
        var target = readMem(reg[PC] + 1) | (readMem(reg[PC] + 2) << 8);
        if (getFlag(entry[1]) === entry[2]) {
            pushWord((reg[PC] + 3) & 0xFFFF);
            reg[PC] = target;
            return 24;
        }
        reg[PC] += 3;
        return 12;
    };
});

[[0xC7, 0x00], [0xCF, 0x08], [0xD7, 0x10], [0xDF, 0x18],
 [0xE7, 0x20], [0xEF, 0x28], [0xF7, 0x30], [0xFF, 0x38]].forEach(function(entry) {
    decode[entry[0]] = function() {
        pushWord((reg[PC] + 1) & 0xFFFF);
        reg[PC] = entry[1];
        return 16;
    };
});

decode[0xC9] = function() { reg[PC] = popWord(); return 16; };
[[0xC0, _Z, 0], [0xC8, _Z, 1], [0xD0, _C, 0], [0xD8, _C, 1]].forEach(function(entry) {
    decode[entry[0]] = function() {
        if (getFlag(entry[1]) === entry[2]) {
            reg[PC] = popWord();
            return 20;
        }
        reg[PC]++;
        return 8;
    };
});
decode[0xD9] = function() { reg[PC] = popWord(); IME = true; return 16; };
