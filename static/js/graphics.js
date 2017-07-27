'use strict';

const defaultPalette = [0x777, 0x700, 0x070, 0x007, 0x111, 0x222, 0x333, 0x444, 0x555, 0x000, 0x001, 0x010, 0x100, 0x200, 0x020, 0x002];

function dumpArray(arr, width) {
	if (width) {
		let arrhex = Array.from(arr).map(v => v.toString(16));
		while(arrhex.length) {
			console.log(arrhex.splice(0, width).join(''));
		}
	} else {
		let arrhex = Array.from(arr).map(v => ('0' + v.toString(16)).substr(-2));
		while(arrhex.length) {
			console.log(arrhex.splice(0, 32).join(' '));
		}
	}
}

// items formats (AtariST graphics.dat file)
// IMG1: 532 (0-20, 22-532). Empty images 16x4: 22, 24
// COD1: 3 (21, 538, 548)
// SND1: 21 (533-537, 539-547, 549-555)
// TXT1: 1 (556)
// FNT1: 1 (557)
// I558: 1 (558)
// I559: 1 (559)
// I560: 1 (560)
// I561: 1 (561)
// I562: 1 (562)

class Screen {
	constructor(canvasctxt) {
		this.drawarea = canvasctxt;
		this.drawarea.imageSmoothingEnabled = false;

		this.imagescache = {};
	}

	async init() {
		this.buildUnpackTable()
		this.setPalette(defaultPalette);
		await this.readGraphics();
		this.extractPortraits();
		this.extractMainFont();
		this.extractPalettes();

		let arrows = this.graphicsFile.read(this.locateNthItem(13), this.itemsCompressedSizes[13]);
		dumpArray(arrows);
	}

	//--------------------------------  Palette ------------------------------------
	// RGB top-to-bottom
	// multiply each color component by 36, so that 0 => 0 and 0x7 => 252 (linear, but using near full range)
	setPalette(newPalette) {
		// we accept either a palette or its number
		if (newPalette.constructor === Number) {
			newPalette = this.palettes[newPalette];
		}
		this.paletteRGBA = newPalette.map((col) => [((col >> 8) & 0x7) * 36, ((col >> 4) & 0x7) * 36, (col & 0x7) * 36, 255]);
		this.paletteStr = newPalette.map((col) => `rgba(${((col >> 8) & 0x7) * 36}, ${((col >> 4) & 0x7) * 36}, ${(col & 0x7) * 36}, 1)`);
		// console.log(JSON.stringify(this.paletteRGBA, null, 4));
	}

	// Palette11914
	// Palette11946
	// Palette11978
	// Palette328
	// Palette360
	// Palette552

	extractPalettes() {
		let data = this.getRawItem(552);
		let palettes = Array.from(data.slice(0x4FE, 0x5FE));
		this.palettes = [];
		for (let i=0; i<8; i++) {
			this.palettes.push(palettes.slice(i*32, (i+1)*32));
		}
	}

	// called with an *i16
	fadeToPalette(newPalette) {
/*
		static dReg D0, D1, D4, D5, D6, D7;
		static i32 i;

		// Set supervisor mode
		for (D4W=0; D4W<8; D4W++) {
			display();
			for (D5W=0; D5W<16; D5W++) {
				D7W = globalPalette[D5W];
				D6W = newPalette.color[D5W];
				D0W = (i16)(D7UW & 7);
				D1W = (i16)(D6UW & 7);
				if (D0W > D1W) D7W--;
				if (D1W > D0W) D7W++;

				D0W = (i16)(D7W & 0x70);
				D1W = (i16)(D6W & 0x70);
				if (D0W > D1W) D7W -= 16;
				if (D1W > D0W) D7W += 16;

				D0W = (i16)(D7W & 0x0700);
				D1W = (i16)(D6W & 0x0700);
				if (D0W > D1W) D7W -= 256;
				if (D1W > D0W) D7W += 256;
				globalPalette[D5W] = D7W;
			}
		}
*/
	}

	//--------------------------------  Bitmaps ------------------------------------
	async readGraphics() {
		this.graphicsFile = new RemoteBinaryFile();
		await this.graphicsFile.get('gamefiles/graphics.dat');
		// this.graphicsFile.data.forEach(byte => console.log(byte));

		this.nbItems = this.graphicsFile.read16();
		if (this.nbItems === 0) {
			throw new Error('Empty graphics file ?');
		}

		this.itemsCompressedSizes = [];
		this.itemsDecompressedSizes = [];
		for (let i=0; i<this.nbItems; i++) {
			this.itemsCompressedSizes.push(this.graphicsFile.read16());
		}
		for (let i=0; i<this.nbItems; i++) {
			this.itemsDecompressedSizes.push(this.graphicsFile.read16());
		}
		// console.log("GraphicCompressedSizes: " + JSON.stringify(this.itemsCompressedSizes));
		// console.log("GraphicDecompressedSizes: " + JSON.stringify(this.itemsDecompressedSizes));
		// console.log("img data start at: " + this.locateNthItem(0).toString(16));

		this.unExpandedGraphics = new Uint32Array(this.nbItems);
		this.graphicIndex0 = new Uint16Array(this.nbItems);
		this.graphicIndex0.fill(-1);

		// preload first graphic ?
		//this.compressedGraphic0 = ReadGraphic(0);
	}

	getRawItem(num) {
		let data = this.graphicsFile.read(this.locateNthItem(num), this.itemsCompressedSizes[num]);

		// uncompress data and check size, if needed
		if (this.itemsCompressedSizes[num] !== this.itemsDecompressedSizes[num]) {
			throw new Error(`Compressed item ${num} !`);
			data = LZWExpand(data);
			if (data.length !== this.itemsDecompressedSizes[num]) {
				throw new Error(`Wrong uncompressed size for item ${num}`);
			}
		}
		return data;
	}

	locateNthItem(num) {
		if (!this.itemsCompressedSizes) {
			throw new Error("!?!");
		}
		let offset = 2 + this.nbItems * 2 * 2; // Skip count and both index.
		for (let i=0; i < num; i++)
			offset += this.itemsCompressedSizes[i];
		return offset;
	}

	// 'expand' used to be the 0x8000 flag in the graph number. expand = false if the flag is set
	readAndExpandGraphic(num, destX, destY, expand, format) {

		let img = this.getImage(num, format);
		this.drawarea.putImageData(img, destX, destY);
/*
		if (expand) {
			ExpandGraphic(graphclear, dest, destX, destY);
		} else {
			// copy data to dest ?
		}
*/
	}

	drawPortrait(num, destX, destY) {
		this.drawarea.putImageData(this.portraits[num], destX, destY);
	}

	getImage(num, format) {
		if (!this.imagescache[num]) {
			// presume IMG1 format
			format = format || 'IMG1';

			let img = this.getRawItem(num);
			const imgW = (img[0] << 8) + img[1];
			const imgH = (img[2] << 8) + img[3];
			// console.log(`width: ${imgW}, height: ${imgH}, length: ${img.length}`);
			// dumpArray(img);

			// fully decode image format into a buffer
			const pixels = [];

			if (format === 'IMG1') {
				let offset = 4;
				while (offset < img.length) {
					let nib1 = img[offset] >> 4;
					let nib2 = img[offset] & 0xf;
					offset += 1;

					// first bit tells if we'll need to read further (1) of if it's a simple 1-8 nib2 repetition (0)
					if (nib1 & 0x8) {
						let nb = 0;
						// second bit tells if we read a byte (0) or a word (1)
						if (nib1 & 0x4) {
							nb = (img[offset] << 8) + img[offset+1];
							offset += 2;
						} else {
							nb = img[offset];
							offset += 1;
						}
						let bits2 = nib1 & 0x3;
						if (bits2 === 0) {
							// add nb+1 pixels of color nib2
							for (let i=0; i<=nb; i++)
								pixels.push(nib2);
						} else if (bits2 === 3) {
							// paste nb+1 pixels of the previous line, and a nib2 pixel
							pixels.push(...pixels.slice(0-imgW, nb+1-imgW));
							pixels.push(nib2);
						} else if (bits2 === 2) {
							throw new Error(`unsupported IMG2 code (${nib1}) before offset ${offset}`);
						} else if (bits2 === 1) {
							if (nb & 1) {
								// Nibble2 is equal to 0 and is ignored.
								if (nib2 !== 0)
									throw new Error(`unsupported IMG2 code (${nib1}/${nib2}) at offset ${offset}`);
								nb += 1;
								// Add 'Byte1 + 1' pixels by reading a nibble (color) for each pixel.
							} else {
								// Add one pixel of the color specified in Nibble2.
								pixels.push(nib2);
								// Add 'Byte1' pixels by reading a nibble (color) for each pixel.
							}
							for (let i=0; i<nb/2; i++) {
								pixels.push(img[offset] >> 4);
								pixels.push(img[offset] & 0xf);
								offset += 1;
							}
						}
					} else {
						// paste nib1+1 pixels of color nib2
						for (let i=0; i<=nib1; i++)
							pixels.push(nib2);
					}
				}
			} else {
				throw new Error(`unsupported image format ${format}`);
			}

			// decoding is finished
			if (pixels.length !== imgW * imgH) {
				throw new Error(`image decoding error, wrong pixel count: expected ${imgW}*${imgH}, got ${pixels.length}`);
			}
			// dumpArray(pixels, imgW);

			// copy data into a new image
			let newImage = new ImageData(imgW, imgH);
			pixels.forEach((color, idx) => {
				for (let j=0; j<4; j++)
					newImage.data[idx*4+j] = this.paletteRGBA[color][j];
			});

			this.imagescache[num] = newImage;
		}
		return this.imagescache[num];
	}

	extractImage(src, posX, posY, width, height) {
		let newImage = new ImageData(width, height);
		let imgW = src.width;
		let imgH = src.height;
		let posSrc = posY*imgW+posX;
		let posDst = 0;
		for (let y=0; y<height; y++) {
			for (let x=0; x<width; x++)
				for (let i=0; i<4; i++)
					newImage.data[(posDst+x)*4+i] = src.data[(posSrc+x)*4+i];
			posSrc += imgW;
			posDst += width;
		}
		return newImage;
	}

	extractPortraits() {
		let pW = 32;
		let pH = 29;
		let baseImage = this.getImage(26);
		this.portraits = [];
		for (let y=0; y<3; y++)
			for (let x=0; x<8; x++)
				this.portraits.push(this.extractImage(baseImage, x*pW, y*pH, pW, pH));
	}

	extractMainFont() {
		let pW = 32;
		let pH = 29;
		// image is compressed...
		// let baseImage = this.getImage(557);
	}

	//--------------------------------  Display ------------------------------------
	display() {
/*
		int areaChangedCount;
		screenAlreadyUnpacked = false;

		static bool initialized = false;
		if (!initialized) {
			memset(black,0,320);
			initialized = true;
		}

		if (d.DynamicPaletteSwitching) {
			memcpy(palette1, &d.Palette11978, 32);
			memcpy(palette2, &d.Palette11946, 32);
			memcpy(globalPalette, &d.Palette11978,32);
		} else {
			memcpy(palette1, globalPalette, 32);
			memcpy(palette2, globalPalette, 32);
		}
		pc1 = HasPaletteChanged(palette1, oldPalette1);
		pc2 = HasPaletteChanged(palette2, oldPalette2);
		pc1 = pc1 || ForcedScreenDraw;
		pc2 = pc2 || ForcedScreenDraw;
		ForcedScreenDraw = false;

		areaChangedCount = 0;
		if (!virtualFullscreen) {
			i32 size = screenSize;
			//Viewport
			areaChangedCount += UpdateScreenArea(physbase(), 0, 0x21, 0xe0, 0xa9-0x21, 0*size, 0x21*size, palette2, pc2, prevScreen, size, videoMode==VM_ADVENTURE);
			//Text scrolling area
			areaChangedCount += UpdateScreenArea(physbase(), 0, 0xa9, 320, 0xc8-0xa9, 0*size, 0xa9*size, palette1, pc1, prevScreen, size, false);
			//portrait area
			areaChangedCount += UpdateScreenArea(physbase(), 0, 0, 320, 0x21, 0*size, 0*size, palette1, pc1, prevScreen, size, false);
			//spells,weapons,moves
			areaChangedCount += UpdateScreenArea(physbase(), 0xe0, 0x21, 0x140-0xe0, 0xa9-0x21, 0xe0*size, 0x21*size, palette2, pc2, prevScreen, size, false);
		} else {
			//Viewport
			if (videoSegSize[0] != 0)
			areaChangedCount += UpdateScreenArea(physbase(), videoSegSrcX[0], videoSegSrcY[0], videoSegWidth[0], videoSegHeight[0], videoSegX[0], videoSegY[0], palette2, pc2, prevScreen, videoSegSize[0], true);
			//portrait area
			if (videoSegSize[1] != 0)
			areaChangedCount += UpdateScreenArea(physbase(), videoSegSrcX[1], videoSegSrcY[1], videoSegWidth[1], videoSegHeight[1], videoSegX[1], videoSegY[1], palette1, pc1, prevScreen, videoSegSize[1], false);
			//spells,weapons,moves
			if (videoSegSize[2] != 0)
			areaChangedCount += UpdateScreenArea(physbase(), videoSegSrcX[2], videoSegSrcY[2], videoSegWidth[2], videoSegHeight[2], videoSegX[2], videoSegY[2], palette2, pc2, prevScreen, videoSegSize[2], false);
			//Text scrolling area
			if (videoSegSize[3] != 0)
			areaChangedCount += UpdateScreenArea(physbase(), videoSegSrcX[3], videoSegSrcY[3], videoSegWidth[3], videoSegHeight[3], videoSegX[3], videoSegY[3], palette1, pc1, prevScreen, videoSegSize[3], false);
		}
		if (areaChangedCount)
			memcpy(prevScreen, physbase(), 32000);

		// Not sure
		// #ifdef _MOVIE
		//   UI_SetDIBitsToDevice(-1,0,0,0,0,0,0,0,0,0,0);
		// #endif
*/
	}

	buildUnpackTable() {
		this.unpack = [];

		let m, i;
		for (i=0; i<256; i++) {
			m = 0;
			if (i & 0x80) m |= 0x00000001;
			if (i & 0x40) m |= 0x00000100;
			if (i & 0x20) m |= 0x00010000;
			if (i & 0x10) m |= 0x01000000;
			if (i & 0x08) m |= 0x00000010;
			if (i & 0x04) m |= 0x00001000;
			if (i & 0x02) m |= 0x00100000;
			if (i & 0x01) m |= 0x10000000;
			this.unpack.push(m);
		}
	}

	// Unpack 64000 (320x200) pixels of ST graphic.
	// Convert from bit-plane to single byte-per-pixel format
	// Takes about a millisecond on Raspberry Pi.
	unpackScreen(src, dst) {
//	unpackScreen(ui8 *src, ui8 *dst) {
/*
		ui32 *piDest = (ui32 *)dst;
		ui32 r;
		int i;
		if (screenAlreadyUnpacked)
			return;
		screenAlreadyUnpacked = true;
		for (i=0; i<64000/16; i++,src+=8,piDest+=4) {
			r = (unpack[src[0]] << 0) | (unpack[src[2]] << 1) | (unpack[src[4]] << 2) | (unpack[src[6]] << 3);
			piDest[0] = r & 0x0f0f0f0f;
			piDest[1] = (r >> 4) & 0x0f0f0f0f;

			r = (unpack[src[1]] << 0) | (unpack[src[3]] << 1) | (unpack[src[5]] << 2) | (unpack[src[7]] << 3);
			piDest[2] = r & 0x0f0f0f0f;
			piDest[3] = (r >> 4) & 0x0f0f0f0f;
		}
*/
	}

	// Returns 1 if screen area changed.
//	UpdateScreenArea(ui8 *STScreen, i32 x0, i32 y0, i32 width, i32 height, i32 dstX, i32 dstY, i16 *palette, bool paletteChanged, ui8 *pOldScreen, i32 size, bool useOverlay) {
/*
		bool overlayChanged = false;
		i32 firstNibble[7];
		i32 firstOverlay[7];
		i32 segWidth[7];
		//i32 LineEnd   = (((x0&0xff0)+width+15)/16) * 8;
		//i32 LineStart = (x0/16) * 8;
		//ui8 *pNibbles = nibbles;
		ui8 *pPixels;
		i32 line, segment, xgj, xoj, ygj, currentGraphicLine, lastGraphicLine;
		//i32 numPixel, skipPixel, n;
		//i16 *pPalette;
		//char *pFirstGroup;
		updateScreenAreaEnterCount++;
		overlayChanged = useOverlay && currentOverlay.m_change;
		currentOverlay.m_change = false;
		if (!paletteChanged && !overlayChanged && !jitterChanged) {
			if (!HasAreaChanged(STScreen, x0, y0, width, height, pOldScreen))  {
				updateScreenAreaLeaveCount++;
				return 0;
			}
		}
		this.unpackScreen(physbase(), fourBitPixels);
		jitterChanged = false;
		currentOverlay.Allocate();
		currentOverlay.CreateOverlayTable(palette, useOverlay);

		STBLTCount++;
		if (useOverlay) {
			xgj = xGraphicJitter;
			xoj = xOverlayJitter;
			ygj = yGraphicJitter;
		} else {
			xgj = 0;
			xoj = 0;
			ygj = 0;
		}
		if (ygj >= 0) {
			currentGraphicLine = -ygj;
			lastGraphicLine = height - ygj - 1;
		} else {
			currentGraphicLine = -ygj;
			lastGraphicLine = height;
		}

		 // There are 13 cases
		 //     xGraphicJitter  xOverlayJitter
		 //          -10            -15    GO-G-B
		 //          -10            -10    GO-B
		 //          -10             -5    GO-O-B
		 //          -10              0    GO-O
		 //          -10             10    G-GO-O
		 //            0            -10    GO-G
		 //            0              0    GO
		 //            0             10    G-GO
		 //           10            -10    O-GO-G
		 //           10              5    B-O-GO
		 //           10              0    O-GO
		 //           10             10    B-GO
		 //           10             15    B-G-GO
		 
		 //     Altogether we have seven segments in each line
		 //         n0 B
		 //         n1 G
		 //         n2 O
		 //         n3 GO
		 //         n4 G
		 //         n5 O
		 //         n6 B
		 
		 //  Now we will determine all the parameters for displaying a
		 //  line for each of 13 possible cases.
		 
		if (xgj < 0) {
			if (xoj == 0) {
				segWidth[0] = 0; 
				segWidth[1] = 0;
				segWidth[2] = 0;
				firstNibble[3] = -xgj;
				firstOverlay[3] = 0;
				segWidth[3] = width + xgj;
				segWidth[4] = 0;
				segWidth[5] = 0;
				segWidth[6] = -xgj;
				firstNibble[6] = -1;
				firstOverlay[6] = width + xgj;
			}
		} else if (xgj == 0) {
			if (xoj == 0) {
				segWidth[0] = 0;
				segWidth[1] = 0;
				segWidth[2] = xgj;
				firstNibble[2] = -1;
				firstOverlay[2] = 0;
				firstNibble[3] = 0;
				firstOverlay[3] = firstOverlay[2]+xgj;
				segWidth[3] = width - xgj;
				segWidth[4] = 0;
				segWidth[5] = 0;
				segWidth[6] = 0;
			}
		} else {
			if (xoj == 0) {
				segWidth[0] = 0;
				segWidth[1] = 0;
				segWidth[2] = xgj;
				firstOverlay[2] = 0;
				firstNibble[2] = -1;
				firstNibble[3] = 0;
				firstOverlay[3] = xgj;
				segWidth[3] = width - xgj;
				segWidth[4] = 0;
				segWidth[5] = 0;
				segWidth[6] = 0;
			}
		}

		for (line=0; line<height; line++, currentGraphicLine++) {
			i32 currentPixel;
			if ((currentGraphicLine < 0) || (currentGraphicLine > lastGraphicLine))
				pPixels = black;
			else
				// Setup parameters for testing newest 
				pPixels = fourBitPixels+320*(y0+currentGraphicLine)+x0;

			currentPixel = 0;

			for (segment=0; segment<7; segment++) {
				unsigned char *pNibbles;
				ui8 *pOverlay;
				if (segWidth[segment] == 0)
					continue;
				//pNibbles = (firstNibble[segment] < 0) ? black : nibbles + firstNibble[segment]; 
				pNibbles = (firstNibble[segment] < 0) ? black : pPixels+firstNibble[segment];
				pOverlay = (useOverlay && overlayActive) ? currentOverlay.m_overlay+224*(135-line) + firstOverlay[segment] : black;

				switch (size) {
					case 1:
						// Raw 8-bit pixel data
						BLT1(pNibbles, (ui16 *)bitmap + 1*(320*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table, pOverlay);
						break;
					case 2:
						// Raw 8-bit pixel data, Destination in BMP data, Width in source, Palette, Overlay pixels data
						BLT2(pNibbles, (ui16 *)bitmap + 2*(320*2*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table, pOverlay);
						break;
					case 3:
						BLT3(pNibbles, (ui16 *)bitmap + 3*(320*3*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table,  pOverlay);
						break;
					case 4:
						BLT4(pNibbles, (ui16 *)bitmap + 4*(320*4*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table,  pOverlay);
						break;
					case 5:
						BLT5(pNibbles, (ui16 *)bitmap + 5*(320*5*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table,  pOverlay);
						break;
					case 6:
						BLT6(pNibbles, (ui16 *)bitmap + 6*(320*6*line + currentPixel), segWidth[segment], (ui16 *)currentOverlay.m_table,  pOverlay);
						break;
					default:
						break;
				}
				currentPixel += segWidth[segment];
			}
		}
		bitmapInfo.bmiHeader.biSize=0x28;
		bitmapInfo.bmiHeader.biWidth=320*size;
		bitmapInfo.bmiHeader.biHeight=-height * size;
		bitmapInfo.bmiHeader.biPlanes=1;
		bitmapInfo.bmiHeader.biBitCount=16;
		bitmapInfo.bmiHeader.biCompression=BI_RGB;
		bitmapInfo.bmiHeader.biSizeImage=0;
		bitmapInfo.bmiHeader.biXPelsPerMeter=0;
		bitmapInfo.bmiHeader.biYPelsPerMeter=0;
		bitmapInfo.bmiHeader.biClrUsed=0;
		bitmapInfo.bmiHeader.biClrImportant=0;
		UI_SetDIBitsToDevice(
			                  // handle to device context
			dstX,             // x-coordinate of upper-left corner of
			                  // dest. rect.
			dstY,             // y-coordinate of upper-left corner of
			                  // dest. rect.
			width*size,       // source rectangle width
			height*size,      // source rectangle height
			0,                // x-coordinate of lower-left corner of
			                  // source rect.
			0,                // y-coordinate of lower-left corner of
			                  // source rect.
			0,                // first scan line in array
			height*size,      // number of scan lines
			(char *)bitmap,   // address of array with DIB bits
			&bitmapInfo,      // address of structure with bitmap info.
			DIB_RGB_COLORS    // RGB or palette indexes
		);
		updateScreenAreaLeaveCount++;
		return 1;
	}
*/
}


// ---------------------- uncompress -------------------------
let	LZWrepeatFlag;
let	LZWlastChar;
let	LZWCodeSize;
let	LZWMaxCode;
let	LZWNextCode;
let LZWResetDict;
// n rightmost bit at 1
const RightOneMask = [0, 1, 3, 7, 15, 31, 63, 127, 255];

//i32 LZWExpand(i16 fileHandle, i32 graphicSize, ui8 *dest, ui8 *scratch, ui8 *stack) // TAG022f64
function LZWExpand(data, scratch) {
/*
	// dictionary
	i16 *WordArray;
	WordArray = (i16 *)scratch;
	memset(WordArray, 0, 512);

	i8  *ByteArray;
	ByteArray = (i8 *)scratch+10006;
	for (let i=0; i<256; i++) {
		ByteArray[i] = (i8)i;
	};

	// we probably get a Uint8Array array that cannot be used as a queue, so copy it
	let indata = [];
	data.forEach(b => indata.push(b));

	let outdata = [];
	let stack = [];

	dReg D0, D4, D6, D7;
	pnt LOCAL_12;
	i16 prevCodeWord;
	LOCAL_12 = (pnt)dest;
	LZWrepeatFlag = 0;
	LZWResetDict = false;

	// start with 9-bits codes (dict keys)
	LZWCodeSize = 9;
	// compute the current max allocable code with that code size
	LZWMaxCode = (1<<LZWCodeSize) - 1;
	// code 256 is reserved for a "clean dict" command
	LZWNextCode = 257;

	prevCodeWord = LZWGetNextCodeword(indata);
	if (prevCodeWord === null) {
		throw new Error("LZW decoding error");
	}
	ProcessChar(prevCodeWord, outdata);

	D7W = prevCodeWord;
	while ((D6W = LZWGetNextCodeword(indata)) > -1) {
		// 256 => clear dictionary
		if(D6W==256) {
			ClearMemory((ui8 *)WordArray, 512);
			LZWResetDict = true;
			LZWNextCode = 256; // ?!? should probably be 257
			D0W = LZWGetNextCodeword(indata);
			D6W = D0W;
			if(D0W === null)
				break;
		}
		D4W = D6W;
		if (D6W >= LZWNextCode) {
			// that's a code that we don't have yet in the dict
			// put this value on the stack
			stack.push(D7B);
			D6W = prevCodeWord;
		}
		// > 256 => dictionary entry, replace D6W with the value from dict
		while (D6W >= 256) {
			// put this value on the stack
			stack.push(ByteArray[D6W]);
			D6W = WordArray[D6W];
		}
		D7W = 0;
		D7B = ByteArray[D6W];
		stack.push(D7B);
		while (stack.length) {
			let val = stack.pop() & 0xff;
			ProcessChar(val, outdata);
		}

		D6W = LZWNextCode;
		if (D6W < 4096) {
			WordArray[D6W] = prevCodeWord;
			ByteArray[D6W] = D7B;
			LZWNextCode = (i16)(D6W + 1);
		}
		prevCodeWord = D4W;
	}
	return outdata;

}

let	LZWBitNumber = 0;
let bitNumber0 = 0; //
let bytesToRead = 0;
let	bytesBuffer = null;

// size 
function LZWGetNextCodeword(data) {
/*
	dReg D0, D3, D5, bitOffset, D7;
	let A3;

	// dictionary is full, we need bigger codes
	if (LZWNextCode > LZWMaxCode) {
		LZWCodeSize++;
		LZWMaxCode = (1 << LZWCodeSize) - 1;
		if (LZWCodeSize == 12) {
			LZWMaxCode++
		}
	}
	if (LZWResetDict) {
		LZWResetDict = false;
		LZWCodeSize = 9;
		LZWMaxCode = (1 << LZWCodeSize) - 1;
		// LZWNextCode is set in parent, to 256
	}

	let bitsLeft = 0;
	let currentByte = null;

	// we need a new code.
	let code = 0;
	let bitsNeeded = LZWCodeSize;
	// while we're not satisfied
	while (bitsNeeded > 0) {
		// if we don't have any bits available, read a new char
		if (bitsLeft === 0)
			currentByte = data.shift();

		// read as many bits from current byte as we have left
		code = (currentByte & RightOneMask[bitsLeft]) << (LZWCodeSize - bitsLeft);
		bitsLeft = 0;

	}

	// 



	// check if we need some maintenance (dict reset, extension or data feed)
	if (LZWBitNumber >= bitNumber0) {

		// ?!? comparing length in bytes to codesize in bits, means we will read 9-12 bytes
		bytesToRead = LZWCodeSize < data.length ? LZWCodeSize : data.length;

		if (bytesToRead === 0) {
			return null;
		}
		// get n bytes in the decode buffer and remove them from input
		bytesBuffer = data.splice(0, bytesToRead);

		LZWBitNumber = 0;
		bitNumber0 = (bytesToRead<<3) - LZWCodeSize + 1;
	}
	LZWBitNumber += LZWCodeSize;
	bitOffset = LZWBitNumber;
	D5 = LZWCodeSize;

	// 
	A3 = bytesBuffer;
	A3 += (bitOffset>>3);
	bitOffset &= 7;
	D7 = 0;
	D7 = *(A3++);
	D7 >>= D6;
	D6 = 8 - D6;
	D5 -= D6;
	if (D5 >= 8) {
		D0 = 0;
		D0 = *(A3++);
		D0 <<= D6;
		D7 |= D0;
		D6 += 8;
		D5 -=8;
	}
	D0 = *A3;

	//return ((D0W & RightOneMask[D5W]) << D6W) | D7W;

	// take the lowest D5 bits, shift left D6, add bits from D7, return that
	D0 &= RightOneMask[D5];
	D0 <<= D6;
	D0 |= D7;
	return D0;
*/
}

// code is a byte we've just read, out is the output string
function ProcessChar(code, out) {

	if(LZWrepeatFlag === 0) {
		// we're not in repeat mode. if next char is 0x90, switch to repeat
		// else simply copy it to destination and memorize it
		if (code === 0x90) {
			LZWrepeatFlag = 1;
		} else {
			LZWlastChar = code; // In case repeat sequence follows
			out.push(code);
		}
	} else {
		// we are in repeat mode, get the count.
		// if it is 0, we actually wanted a 0x90, not a repeat :)
		// else repeat the char n times
		LZWrepeatFlag = 0;
		if (code > 0) {
			// we already copied it once before reading the 0x90
			for (let i=0; i<code-1; i++) {
				out.push(LZWlastChar);
			}
		} else {
			out.push(0x90)
		}
	}
}
