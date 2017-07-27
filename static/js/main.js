// used for all queries to the server
let server = new Server();

let screen = null;

async function start() {
	let canvas = document.getElementById("mainscreen");
	if (!canvas.getContext) {
		throw new Error("Can't find canvas");
	}
	// screen holds all the graphic data files and methods to draw on canvas
	screen = new Screen(canvas.getContext("2d"));
	await screen.init();

	screen.setPalette(0);
	screen.readAndExpandGraphic(4, 0, 0);
	// screen.readAndExpandGraphic(26, 0, 40);
	// screen.readAndExpandGraphic(22, 0, 180);

	// put all portraits, BECAUSE WE CAN
	for (let y=0; y<3; y++)
		for (let x=0; x<8; x++)
			screen.drawPortrait((2-y)*8+(7-x), 40*x+5, 35+y*35);
	draw(screen.paletteStr);
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
