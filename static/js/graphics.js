'use strict';

// items formats (AtariST graphics.dat file)
// FNT1: 1 (557)
// I558: 1 (558)
// I559: 1 (559)
// I560: 1 (560)
// I561: 1 (561)
// I562: 1 (562)

class Screen {
	constructor(canvasctxt, zoom) {
		this.drawarea = canvasctxt;
		this.drawarea.imageSmoothingEnabled = false;
		this.zoom = zoom || 1;

		// each cache stores the raw pixels and renderings for each palette
		this.imagescache = {};
		// stores for extracted data.
		this.collections = {portraits:[], items:[], itemnames:[], font:[]};

		// each sound can be at different frequency rate
		this.soundscache = {};

		this.audioctx = new AudioContext();
	}

	async init() {
		this.buildUnpackTable()
		this.setPalette(defaultPalette);
		await this.readGraphics();
		this.extractPalettes();
		await this.extractPortraits();
		await this.extractItems();
		this.extractItemNames();
		// await this.extractMainFont();

		for (let num in imagesIndex) {
			let info = imagesIndex[num];
			for (let palette of info.palettes || palettesInterface) {
				if (!info.nopreload)
					await this.preloadImage(num, palette);
			}
		}
		for (let num in soundsIndex)
			this.preloadSound(num, soundsIndex[num]);
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
		this.paletteStr = this.paletteRGBA.map((col) => `rgba(${col[0]}, ${col[1]}, ${col[2]}, 1)`);
	}

	extractPalettes() {
		let data = this.getRawItem(562);
		let palettes = Array.from(data.slice(0x4FE, 0x5FE));
		this.palettes = [];
		let pos = 0;
		for (let i=0; i<8; i++) {
			let newPal = [];
			for (let j=0; j<16; j++) {
				newPal.push((palettes[pos] << 8) + palettes[pos+1]);
				pos += 2;
			}
			this.palettes.push(newPal);
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

	// gives the position of an "image" byte sequence
	locateNthItem(num) {
		if (!this.itemsCompressedSizes) {
			throw new Error("!?!");
		}
		let offset = 2 + this.nbItems * 2 * 2; // Skip count and both index.
		for (let i=0; i < num; i++)
			offset += this.itemsCompressedSizes[i];
		return offset;
	}

	//---------------- low-level buffer and bitmap decoding

	// extracts an "image" data from graphics file, uncompressing it if needed
	getRawItem(num) {
		let data = this.graphicsFile.read(this.locateNthItem(num), this.itemsCompressedSizes[num]);

		// uncompress data and check size, if needed
		if (this.itemsCompressedSizes[num] !== this.itemsDecompressedSizes[num]) {
			data = LZWexpand(data);
			data = RLEexpand(data);
			if (data.length !== this.itemsDecompressedSizes[num]) {
				throw new Error(`Wrong uncompressed size for item ${num} (expected ${this.itemsDecompressedSizes[num]}, got ${data.length})`);
			}
		}
		return data;
	}

	// returns the image from cache or extracts and decode it from file
	// if we ask for raw data, it is never taken from cache and we get an ImageData
	// else we get a (maybe cached) ImageBitmap
	getImage(num, palette, nocache, format) {
		let pixels;
		let imgW;
		let imgH;
		if (this.imagescache[num] && this.imagescache[num].pixels) {
			pixels = this.imagescache[num].pixels;
			imgW = this.imagescache[num].width;
			imgH = this.imagescache[num].height;
		} else {
			// presume IMG1 format
			format = format || 'IMG1';

			let img = this.getRawItem(num);
			imgW = (img[0] << 8) + img[1];
			imgH = (img[2] << 8) + img[3];
			pixels = [];
			// console.log(`width: ${imgW}, height: ${imgH}, length: ${img.length}`);
			// dumpArray(img);

			// fully decode image format into a buffer
			if (format === 'IMG1') {
				let offset = 4;
				while (offset < img.length) {
					let nib1 = img[offset] >> 4;
					let nib2 = img[offset] & 0xf;
					offset += 1;

					// first bit tells if we'll need to read further (1) of if it's a simple 1-8 nib2 repetition (0)
					if (nib1 & 0x8) {
						let nb = 0;
						// second bit tells if we read a word (1) or a byte (0)
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
							// the copy may include pixels that are not there yet (nb+1 > imgW)
							// OPTIMIZE: this could be faster by copying slices of max imgW pixels
							let cpnb = nb+1;
							let pos = pixels.length-imgW;
							while (cpnb-- > 0)
								pixels.push(pixels[pos++]);
							pixels.push(nib2);
						} else if (bits2 === 2) {
							// A and D (transparent pixels) are only used for animation files
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

			if (!nocache)
				this.imagescache[num] = {pixels: pixels, width: imgW, height: imgH, renders: {}};
		}

		// REFACTOR: we should be able to directly use the right palette without globally loading it
		this.setPalette(palette);

		let transparency = imagesIndex[num].transparency;

		// copy data into a new image, applying current palette
		let newImage = new ImageData(imgW, imgH);
		pixels.forEach((color, idx) => {
			for (let j=0; j<3; j++)
				newImage.data[idx*4+j] = this.paletteRGBA[color][j];
			newImage.data[idx*4+3] = color === transparency ? 0 : 255;
		});
		return newImage;
	}

	async preloadImage(num, palette) {
		// console.log(`preloading ${num} for palette ${palette}`);
		let img = await createImageBitmap(this.getImage(num, palette));
		this.imagescache[num].renders[palette] = img;
	}

	//---------------- high-level image manipulations

	// draw an image at a coordinates
	// 'expand' used to be the 0x8000 flag in the graph number. expand = false if the flag is set
	readAndExpandGraphic(num, destX, destY, palette, expand) {
		// console.log(`'read and expand: ${num} / ${palette}`);
		if (!this.imagescache[num])
			throw new Error(`Image ${num} was not preloaded !`);

		let availablePalettes = Object.keys(this.imagescache[num].renders);
		if (palette === undefined) {
			if (availablePalettes.length > 1)
				throw new Error(`Image ${num} has more than one palette (${availablePalettes.join(',')}) !`);
			palette = availablePalettes[0];
		}

		if (palette && !this.imagescache[num].renders[palette])
			throw new Error(`Image ${num} was not preloaded for palette ${palette} !`);

		this.drawImage(this.imagescache[num].renders[palette], destX, destY);
		// if (expand) {
		// 	ExpandGraphic(graphclear, dest, destX, destY);
		// } else {
		// 	// copy data to dest ?
		// }
	}

	// draw an image from a collection
	drawCollectionImage(collection, num, destX, destY) {
		this.drawImage(this.collections[collection][num], destX, destY);
	}

	// takes an ImageBitmap
	drawImage(img, destX, destY) {
		this.drawarea.drawImage(img, destX*this.zoom, destY*this.zoom, img.width*this.zoom, img.height*this.zoom);
/*
		if (this.zoom === 1){
			// faster
		} else {
			let z = this.zoom;
			let dest = this.drawarea.getImageData();
			// iterate over all image pixels
			for (let y=0; y<img.height; y++) {
				if ((destY+y)*z >= dest.height)
					break;
				for (let x=0; x<img.width; x++) {
					// check if we're out of the target
					if ((destX+x)*z >= dest.width)
						break;
					let pos = (destY+y)*z*dest.width*4 + (destX+x)*z*4;
					for (let j=0; j<z; j++) {
						for (let i=0; i<z; i++) {
							for (let k=0; k<4; k++)
								dest.data[pos + i*4 + k] = img.data[(y*img.width+x)*4 + k];
						}
						pos += dest.width*4;
					}
				}
			}
		}
*/
	}

	// builds a new ImageData from a box in the source image
	async extractImage(src, posX, posY, width, height) {
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
		let img = await createImageBitmap(newImage);
		return img;
	}

	// builds a table by extracting portraits from entry 26
	async extractPortraits() {
		let pW = 32;
		let pH = 29;
		this.setPalette(0);
		let baseImage = this.getImage(26, 0);
		this.portraits = [];
		for (let y=0; y<3; y++)
			for (let x=0; x<8; x++)
				this.collections.portraits.push(await this.extractImage(baseImage, x*pW, y*pH, pW, pH));
	}

	// item names are in entry 556
	extractItemNames() {
		let data = this.getRawItem(556);
		this.itemNames = [];
		let newName = [];
		while(data.length > 0) {
			let c = data.shift();
			newName.push(String.fromCharCode(c & 0x7f));
			if (c & 0x80) {
				// last word char
				this.collections.itemnames.push(newName.join(''));
				newName = [];
			}
		}
	}

	// items are in images 42 to 48
	async extractItems() {
		this.items = [];
		screen.setPalette(0);
		for (let i=42; i<=48; i++) {
			let img = this.getImage(i, 0);
			for (let y=0; y<2; y++)
				for (let x=0; x<16; x++)
					this.collections.items.push(await this.extractImage(img, x*16, y*16, 16, 16))
		}
	}

	// builds a font table by extracting chars from entry 557
	extractMainFont() {
		let pW = 32;
		let pH = 29;
		let baseImage = this.getImage(557, 0);
		// ...
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
	//--------------------------------  Sound ------------------------------------
	preloadSound(num, info) {
		let rateTarget = this.audioctx.sampleRate;
		let data = this.getRawItem(num);
		// dumpArray(data);
		data = SNDexpand(data);

		// console.log(`preloading sound ${num}`);
		this.soundscache[num] = [];
		for (let rate of info.rates || ratesDefault) {
			let duration = data.length / ratesDefault[0];
			let newBuffer = this.audioctx.createBuffer(1, duration * rateTarget, rateTarget);
			let channel = newBuffer.getChannelData(0);
			// fill the channel
			let factor = this.audioctx.sampleRate / rate;
			for (let i=0; i<duration*rateTarget; i++)
				channel[i] = (data[Math.floor(i/factor)] - 127.5) / 127.5;

			// console.log(JSON.stringify(channel));

			this.soundscache[num].push({
				duration: duration,
				buffer: newBuffer,
			});
		}
	}

	playSound(num, rateIdx) {
		return new Promise((resolve, reject) => {
			if (!this.soundscache[num])
				throw new Error(`Sound ${num} was not preloaded !`);
			let data = this.soundscache[num][rateIdx || 0];
			if (!data)
				throw new Error(`Sound ${num} has no ${rateIdx} rate !`);

			// console.log(`Playing sound ${num}`);

			let source = this.audioctx.createBufferSource();
			// set the buffer in the AudioBufferSourceNode
			source.buffer = data.buffer;
			// connect the AudioBufferSourceNode to the
			// destination so we can hear the sound
			source.connect(this.audioctx.destination);
			// start the source playing
			source.start();
			setTimeout(() => resolve(), data.duration * 1000);
		});
	}

	// preloading sound 533, Sound has 99 samples, expected 100
	// preloading sound 543, Sound has 1018 samples, expected 1019
	// preloading sound 545, Sound has 961 samples, expected 962
}
