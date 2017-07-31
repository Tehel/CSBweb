'use strict';


let server = null;		// used for all queries to the server
let screen = null;		// access to all data from graphics.dat and display
let dungeon = null;		// access to dungeon.dat
let keys = null;		// key management
let zonerunner = null;	// main event loop

async function start() {
	let canvas = document.getElementById("mainscreen");
	if (!canvas.getContext) {
		throw new Error("Can't find canvas");
	}
	keys = new Keys();
	server = new Server();

	// screen holds all the graphic data files and methods to draw on canvas
	screen = new Screen(canvas.getContext("2d"), 2);
	await screen.init();

	dungeon = new Dungeon();
	await dungeon.init();

	// screen.setPalette(6);
	// screen.readAndExpandGraphic(4, 0, 0);
	// screen.readAndExpandGraphic(2, 0, 30);
	// screen.readAndExpandGraphic(3, 104, 30);

	// screen.setPalette(0);
	// screen.readAndExpandGraphic(13, 10, 35);
	// screen.readAndExpandGraphic(192, 100, 5, 0);
	// screen.readAndExpandGraphic(381, 180, 5, 0);
	// screen.readAndExpandGraphic(481, 180, 35, 0);

	// for (let id in soundsIndex)
	// 	for (let i in soundsIndex[id].rates || [0])
	// 		await screen.playSound(id, i);

	// await screen.playSound(535, 1);
	// for (let i=533; i<=555; i++)
	// 	await screen.playSound(i);

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

	zonerunner = new ZoneRunner();
	zonerunner.load('menu', new ZoneMenu());
	zonerunner.load('game', new ZoneGame());
	// zonerunner.load('debug', new ZoneDebug());
	zonerunner.select('menu');
}

// ---------------- main event loop ----------------

// called every 100ms to
// - trigger actions on inputs
// - make the world run a step (monsters)


// ---------------- environment setups ----------------

class ZoneRunner {
	constructor() {
		this.zones = {};
		this.currentZone = null;
		let self = this;
		this.timer = setInterval(() => self.run(self), 100);
	}
	load(name, zone) {
		this.zones[name] = zone;
	}
	select(name) {
		// console.log(`select zone ${name}`);
		if (!this.zones[name])
			throw new Error(`Unknown zone ${name}`);
		this.changeToZone = name;
	}
	run(self) {
		// can't rely on 'this' coming from setInterval, so take it as argument
		let redraw;

		if (self.changeToZone) {
			// console.log(`switching to zone ${name}`);
				if (this.currentZone)
				this.currentZone.exit();
			this.currentZone = this.zones[self.changeToZone];
			this.currentZone.init();
			self.changeToZone = null;
			keys.clearQueue();
			screen.clear();
			redraw = true;
		}

		try {
			redraw |= self.currentZone.processInputs(self, keys.queue);	// also capture and give mouse click events
			redraw |= self.currentZone.runWorld();

			if (redraw)
				self.currentZone.drawView();
		} catch(err) {
			// stop loop
			clearInterval(self.timer);
			throw err;
		}
	}
}

class Zone {
	constructor() {}
	// reactions to keys and mouse inputs. Takes runner to 
	processInputs(runner) { throw new Error('Missing input processing ?'); }
	// run the world's asynchronous evolution
	runWorld() { throw new Error('Missing world run ?'); }
	// draw the screen
	drawView() { throw new Error('Missing draw function ?'); }
	// called when entering zone. setup key bindings.
	init() {}
	// called when leaving. unset key bindings
	exit() {}
}


// ---------------- debug ----------------
// class ZoneDebug extends Zone {
// 	constructor() {
// 		// setup menu tree
// 	}
// }

// ---------------- game ----------------
class ZoneGame extends Zone {
	constructor() {
		super();
		// setup game
	}
	init() {
		keys.loadBindings('meta');
		keys.loadBindings('movement');
		keys.loadBindings('spells');
		keys.loadBindings('attack');
		keys.loadBindings('inventories');
	}

	exit() {
		keys.unloadBindings('meta');
		keys.unloadBindings('movement');
		keys.unloadBindings('spells');
		keys.unloadBindings('attack');
		keys.unloadBindings('inventories');
	}
	processInputs(runner, keyqueue) {
		let redraw = false;
		if (keyqueue.length > 0) {
			let action = keyqueue.shift();
			console.log(`got key input '${action}'`);
			switch(action) {
				case 'to debug':
					runner.select('menu');
					break;
				default:
					throw new Error(`action '${action}' has no handler`);
			}
		}
		// no mouse event managed
		return redraw;
	}
	runWorld() {}
	drawView() {
		screen.clear();
		screen.readAndExpandGraphic(4, 0, 0);
		screen.readAndExpandGraphic(2, 0, 30);
		screen.readAndExpandGraphic(3, 104, 30);
	}
}

/*
function draw(palette) {
	let canvas = document.getElementById("mainscreen");
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
*/
