'use strict';

class RemoteBinaryFile {
	constructor(){
		this.data = null;
		this.pos = 0;
	}
	get(url) {
		return new Promise(async (resolve, reject) => {
			try {
				let data = await server.get(url, {responseType: 'arraybuffer'});
				this.data = new Uint8Array(data);
				resolve();
			} catch(err) {
				reject(new Error(`Failed to fetch file ${url}: ${err}`));
			}
		});
	}
	// nodeJs version for reading local file
	// get(filepath) {
	// 	return new Promise(async (resolve, reject) => {
	// 		const fs = require('fs');
	// 		try {
	// 			this.data = new Uint8Array(fs.readFileSync(filepath));
	// 			resolve();
	// 		} catch(err) {
	// 			reject(new Error(`Failed to read file ${filepath}: ${err}`));
	// 		}
	// 	});
	// }
	length() {
		return this.data.length;
	}
	tell() {
		return this.pos;
	}
	seek(newpos) {
		this.pos = newpos;
	}
	skip(bytenumber) {
		this.pos += bytenumber;
	}
	// Can be called with only length, or position+length. returns a subarray
	read(position, length) {
		// if length is undefined, it is actually in the first arg, and we read from the current position
		let startpos = length ? position : this.pos;
		let endpos = startpos + (length ? length : position);
		let sub = this.data.subarray(startpos, endpos);
		if (!length) {
			this.pos += position;
		}
		return sub;
	}
	read8(position) {
		if (position)
			this.pos = position;
		let value = this.data[this.pos];
		this.pos += 1;
		return value;
	}
	// implicitely presume big-endianism.
	read16(position) {
		if (position)
			this.pos = position;
		return (this.read8() << 8) + this.read8();
	}
	read32(position) {
		if (position)
			this.pos = position;
		return (this.read16() << 16) + this.read16();
	}
}

/*
// for now we completely ignore the Signature check on files
// this is presumably used so that loaded saved games can ensure that they have the correct data files
function Signature(buffer) {
	// compute file's MD5
	// we'll only use the lower 8 bytes
	const crypto = require('crypto');
	const md5 = crypto.createHash('md5').update(buffer).digest();
	const sig1 = (md5[0] | (md5[1]<<8) | (md5[2]<<16) | (md5[3]<<24)) || 1;
	const sig2 = md5[4] | (md5[5]<<8) | (md5[6]<<16) | (md5[7]<<24);

	return [sig1, sig2];
}
*/
