'use strict';

let LZWCodeSize = null;
let LZWMaxCode = 0;
let LZWNextCode = 0;
let LZWresetDict = null;

let RLErepeatFlag = 0;
let RLErepeatChar = null;

function LZWExpand(datatodecode) {
	let buffer = {
		data: datatodecode,
		position: 0,
	};
	let out = [];

	// dictionary
	let wordArray = (new Array(512)).fill(0);

	let byteArray = new Array(256);
	for (let i=0; i<256; i++)
		byteArray[i] = i;

	let D4, D6, D7;
	let prevCodeWord;

	let stack = [];

	// start with 9-bits codes (dict keys)
	LZWCodeSize = 9;
	// compute the current max allocable code with that code size
	LZWMaxCode = (1<<LZWCodeSize) - 1;
	// code 256 is reserved for a "clean dict" command
	LZWNextCode = 257;
	LZWresetDict = false;

	RLErepeatFlag = false;

	// read first code
	D7 = LZWGetNextCodeword(buffer);
	if (D7 === -1)
		throw new Error('Nothing to decode !');
	decodeRLE(D7, out);

	prevCodeWord = D7;
	while ((D6 = LZWGetNextCodeword(buffer)) !== -1) {
		// console.log(`got code ${D6.toString(16)} (position ${buffer.position})`);
		if (D6 === 256) {
			console.log(`reset dict !`);
			wordArray.fill(0);
			LZWresetDict = true;
			LZWNextCode = 256;
			continue;
		}
		D4 = D6;
		if (D6 >= LZWNextCode) {
			// console.log(`reference to future dict entry ${D6}`);
			// that's a code that we don't have yet in the dict
			// put this value on the stack
			stack.push(D7);
			D6 = prevCodeWord;
		}
		while (D6 >= 256) {
			// console.log(`reference to dict entry ${D6}`);
			stack.push(byteArray[D6]);
			D6 = wordArray[D6];
		}
		D7 = byteArray[D6];
		stack.push(D7);
		while(stack.length > 0)
			decodeRLE(stack.pop(), out);

		if (LZWNextCode < 4096) {
			// check: wordArray and byteArray are probably the lists of positions/lengths of dict entries in the string
			// we don't store nor use them correctly
			// console.log(`new dict entry: code ${LZWNextCode}, ${prevCodeWord.toString(16)}/${D7.toString(16)}`);
			wordArray[LZWNextCode] = prevCodeWord;
			byteArray[LZWNextCode] = D7;
			LZWNextCode += 1;
		}
		prevCodeWord = D4;
		// if (buffer.position > 400)
		// 	break;
	}
	return out;
}

// bit number
let LZWvar1 = 0;
let LZWBitNumber = 0;

// mask to keep only the n rightmost bits
const rightBits = [0, 1, 3, 7, 15, 31, 63, 127, 255];
let ioBuffer = [];

// !!! must refactor to avoid using ioBuffer. Bytes can be read from buffer directly when needed
function LZWGetNextCodeword(buffer) {
	if (LZWresetDict || LZWBitNumber >= LZWvar1 || LZWNextCode > LZWMaxCode) {
		// need dictionary extension
		if (LZWNextCode > LZWMaxCode) {
			LZWCodeSize++;
			if (LZWCodeSize == 12)
				LZWMaxCode = 4096;
			else
				LZWMaxCode = (1 << LZWCodeSize) - 1;
		}
		// dictionary reset requested
		if (LZWresetDict) {
			LZWCodeSize = 9;
			LZWMaxCode = (1 << LZWCodeSize) - 1;
			LZWresetDict = false;
		}

		// no more data -> finished
		if (buffer.position >= buffer.data.length)
			return -1;

		// get min(LZWCodeSize, remain)
		let remain = buffer.data.length - buffer.position;
		let nbtoread = remain < LZWCodeSize ? remain : LZWCodeSize;

		// reads LZWvar1 bytes from buffer to iOBuffer
		ioBuffer = Array.from(buffer.data.slice(buffer.position, buffer.position + nbtoread));
		buffer.position += nbtoread;

		LZWBitNumber = 0;
		LZWvar1 = (nbtoread<<3) - LZWCodeSize + 1;
	}
	// our position in the buffer
	let bitposition = LZWBitNumber;

	// pointer to ioBuffer, used for reads
	let offset = bitposition >> 3;
	// now use position inside byte
	bitposition &= 7;
	// read next byte, keep the LEFT ones
	let code = ioBuffer[offset];
	offset += 1;
	code >>= bitposition;
	let bitswehave = 8 - bitposition;

	// if we need more than 8, read a byte and add it on the left
	if (LZWCodeSize - bitswehave >= 8) {
		code |= ioBuffer[offset] << bitswehave;
		offset += 1;
		bitswehave += 8;
	}
	// read bits from next byte, add them on the left of the code
	code |= (ioBuffer[offset] & rightBits[LZWCodeSize - bitswehave]) << bitswehave;
	// point position to next code
	LZWBitNumber += LZWCodeSize;
	// console.log(`read code ${code.toString(16)}`);
	return code;
}

// simple RLE compression
// [byte][0x90][nb] means "repeat [byte] [nb] times".
// [0x90][0x0] means "print 0x90"
function decodeRLE(char, out) {
	if(!RLErepeatFlag) {
		// we're not in repeat mode. if char is 0x90, switch to repeat
		// else simply copy it to destination and memorize it
		if (char === 0x90){
			RLErepeatFlag = true;
		} else {
			RLErepeatChar = char; // In case repeat sequence follows
			out.push(char);
		}
	} else {
		RLErepeatFlag = false;
		// we are in repeat mode, char is the count.
		// if it is 0, we actually wanted a 0x90, not a repeat :)
		// else repeat the char n-1 times (we already put it once before)
		if (char > 0) {
			for (let i=0; i<char-1; i++){
				out.push(RLErepeatChar);
			}
		} else {
			out.push(0x90);
		}
	}
}
