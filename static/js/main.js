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

	// draw random items
	// for (let y=0; y<9; y++)
	// 	for (let x=0; x<15; x++)
	// 		screen.drawCollectionImage('items', Math.floor(Math.random()*screen.collections.items.length), 5+20*x, 5+20*y);

	zonerunner = new ZoneRunner();
	zonerunner.load('menu', new ZoneMenu());
	zonerunner.load('game', new ZoneGame());
	zonerunner.select('menu');
}

// ---------------- main event loop ----------------

// called every 100ms to
// - trigger actions on inputs
// - make the world run a step (monsters)


// ---------------- environment setups ----------------

class ZoneRunner {
	constructor() {
		this.refreshTime = 100;
		this.zones = {};
		this.currentZone = null;
		let self = this;
		this.timer = setInterval(() => self.run(self), 10);
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
			this.currentZone.init(self);
			self.changeToZone = null;
			keys.clearQueue();
			screen.clear();
			clearInterval(self.timer);
			self.timer = setInterval(() => self.run(self), self.refreshTime);
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
	// called when entering zone. setup key bindings, refresh time.
	init() {}
	// called when leaving. unset key bindings
	exit() {}
}

// ---------------- game ----------------
class ZoneGame extends Zone {
	constructor() {
		super();
		// setup game
	}
	init(runner) {
		keys.loadBindings('meta');
		keys.loadBindings('movement');
		keys.loadBindings('spells');
		keys.loadBindings('attack');
		keys.loadBindings('inventories');
		runner.refreshTime = 100;	// 10 refreshs per second
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
			// console.log(`got key input '${action}'`);
			switch(action) {
				case 'to menu':
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
