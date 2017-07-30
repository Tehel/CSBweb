'use strict';

// used for all queries to the server
let server = new Server();

// all access to data from graphics.dat and display
let screen = null;
let dungeon = null;
let keys = null;

async function start() {
	let canvas = document.getElementById("mainscreen");
	if (!canvas.getContext) {
		throw new Error("Can't find canvas");
	}
	// screen holds all the graphic data files and methods to draw on canvas
	screen = new Screen(canvas.getContext("2d"), 2);
	await screen.init();

	dungeon = new Dungeon();
	await dungeon.init();

	screen.setPalette(6);
	await screen.readAndExpandGraphic(4, 0, 0);
	await screen.readAndExpandGraphic(2, 0, 30);
	await screen.readAndExpandGraphic(3, 104, 30);

	// screen.setPalette(0);
	screen.readAndExpandGraphic(13, 10, 35);
	screen.readAndExpandGraphic(192, 100, 5, 0);
	screen.readAndExpandGraphic(381, 180, 5, 0);
	screen.readAndExpandGraphic(481, 180, 35, 0);

	keys = new Keys();
	keys.setup(['menu']);

	// await screen.playSound(533);
	// await screen.playSound(534);
	// await screen.playSound(535);
	// await screen.playSound(535, 1);

	// await screen.playSound(536);
	// await screen.playSound(537);
	// await screen.playSound(539);
	// await screen.playSound(540);
	// await screen.playSound(541);
	// await screen.playSound(542);
	// await screen.playSound(543);
	// await screen.playSound(544);
	// await screen.playSound(545);
	// await screen.playSound(546);
	// await screen.playSound(547);
	// await screen.playSound(549);
	// await screen.playSound(550);
	// await screen.playSound(551);
	// await screen.playSound(552);
	// await screen.playSound(553);
	// await screen.playSound(554);
	// await screen.playSound(555);

	// screen.readAndExpandGraphic(26, 0, 40);
	// screen.readAndExpandGraphic(22, 0, 180);

	// put all portraits, BECAUSE WE CAN
	// for (let y=0; y<3; y++)
	// 	for (let x=0; x<8; x++)
	// 		screen.drawCollectionImage('portraits', y*8+x, 5+35*x, 92+32*y);

	// draw random items
	// for (let y=0; y<9; y++)
	// 	for (let x=0; x<15; x++)
	// 		screen.drawCollectionImage('items', Math.floor(Math.random()*screen.collections.items.length), 5+20*x, 5+20*y);

	// console.log(screen.collections.itemnames);

	// draw(screen.paletteStr);
}

function draw(palette) {
	let canvas = document.getElementById("testcanvas");
	if (canvas.getContext) {
		let ctx = canvas.getContext("2d");

		// draw ST palette
		ctx.strokeRect(0, 0, 401, 26);
		for (let i=0; i<16; i++){
			ctx.fillStyle = palette[i];
			ctx.fillRect(1+i*25, 1, 25, 25);
		}
	}
}
