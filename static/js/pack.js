'use strict';

// REFACTOR: avoid using ioBuffer. Bytes can be read from buffer directly when needed
function LZWexpand(datatodecode) {
	let dataposition = 0;
	let out = [];

	// mask to keep only the n rightmost bits
	const rightBits = [0, 1, 3, 7, 15, 31, 63, 127, 255];

	// dictionary:
	// wordArray is actually a chain of codes, at each step we enqueue the corresponding byteArray entry
	// and loop until we find a code < 256.
	// they can be much larger than 512 and 256 respectively
	let wordArray = (new Array(512)).fill(0);
	let byteArray = new Array(256);
	for (let i=0; i<256; i++)
		byteArray[i] = i;

	let D4, D7;
	let prevCodeWord;
	let newCode;

	let stack = [];

	// bit number
	let LZWvar1 = 0;
	let LZWBitNumber = 0;
	let ioBuffer = [];

	// start with 9-bits codes (dict keys)
	let LZWCodeSize = 9;
	// compute the current max allocable code with that code size
	let LZWMaxCode = (1<<LZWCodeSize) - 1;
	// code 256 is reserved for a "clean dict" command
	let LZWNextCode = 257;
	let LZWresetDict = false;

	while (1) {

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
			if (dataposition >= datatodecode.length)
				break;

			// get min(LZWCodeSize, remain)
			let remain = datatodecode.length - dataposition;
			let nbtoread = remain < LZWCodeSize ? remain : LZWCodeSize;

			// reads bytes from buffer to iOBuffer
			ioBuffer = Array.from(datatodecode.slice(dataposition, dataposition + nbtoread));
			dataposition += nbtoread;

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
		newCode = ioBuffer[offset];
		offset += 1;
		newCode >>= bitposition;
		let bitswehave = 8 - bitposition;

		// if we need more than 8, read a byte and add it on the left
		if (LZWCodeSize - bitswehave >= 8) {
			newCode |= ioBuffer[offset] << bitswehave;
			offset += 1;
			bitswehave += 8;
		}
		// read bits from next byte, add them on the left of the code
		newCode |= (ioBuffer[offset] & rightBits[LZWCodeSize - bitswehave]) << bitswehave;
		// point position to next code
		LZWBitNumber += LZWCodeSize;
		// console.log(`read code ${code.toString(16)}`);

		if (newCode === -1) {
			break;
		}
		if (out.length === 0) {
			// first code is never a dict reference
			out.push(newCode);
			prevCodeWord = newCode;
			D7 = newCode;
			continue;
		}
		if (newCode === 256) {
			wordArray.fill(0);
			LZWresetDict = true;
			LZWNextCode = 256;
			continue;
		}
		D4 = newCode;
		if (newCode >= LZWNextCode) {
			// that's a code that we don't have yet in the dict
			// put this value on the stack
			stack.push(D7);
			newCode = prevCodeWord;
		}
		while (newCode >= 256) {
			stack.push(byteArray[newCode]);
			newCode = wordArray[newCode];
		}
		D7 = byteArray[newCode];
		stack.push(D7);
		while(stack.length > 0)
			out.push(stack.pop());

		if (LZWNextCode < 4096) {
			// check: wordArray and byteArray are probably the lists of positions/lengths of dict entries in the string
			// we don't store nor use them correctly
			wordArray[LZWNextCode] = prevCodeWord;
			byteArray[LZWNextCode] = D7;
			LZWNextCode += 1;
		}
		prevCodeWord = D4;
	}
	if (out.length === 0)
		throw new Error('Nothing to decode !');
	return out;
}

// simple RLE compression
// [byte][0x90][nb] means "repeat [byte] [nb] times".
// [0x90][0x0] means "print 0x90"
function RLEexpand(chars) {
	let RLErepeatFlag = false;
	let RLErepeatChar = null;
	let out = [];

	chars.forEach(char => {
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
	});
	return out;
}
