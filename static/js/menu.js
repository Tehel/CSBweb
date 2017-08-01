'use strict';

// set menus to access all game resources
// could also allow access to runtime game structures (dynamic generation of menus)

// ---------------- menu ----------------
class ZoneMenu extends Zone {
	constructor() {
		super();
		// setup menu tree
		this.menus = {
			main: {
				title: 'Main menu',
				subtitle: 'Choose what to do',
				items: [
					{text: 'Game', actionEnter: ['goZone', 'game']},
					{submenu: 'resources'},
					{submenu: 'runtime'},
				]
			},
			resources: {
				title: 'Resources',
				subtitle: 'Browse the game props',
				items: [
					{submenu: 'images'},
					{submenu: 'sounds'},
					{submenu: 'maps'},
				]
			},
			images: {
				title: 'Images',
				items: [
					{submenu: 'imgPortraits'},
					{submenu: 'imgDungeonGraphics'},
					{submenu: 'imgDoor'},
					{submenu: 'imgWallOrnate'},
					{submenu: 'imgItemOnFloor'},
					{submenu: 'imgInventoryitems'},
					{submenu: 'imgCreatures'},
					{submenu: 'imgFonts'},
				],
			},
			imgPortraits: {
				title: 'Heroes',
				items: () => {
					let newItems = [];
					// build items from portraits list
					screen.collections.portraits.forEach((entry, idx) => {
						newItems.push({
							text: `hero ${idx}`,
							actionSelect: ['showImage', {collection: 'portraits', idx: idx}],
						});
					});
					return newItems;
				},
			},
			imgDungeonGraphics: {
				title: 'Dungeon Graphics',
				items: () => this.filterImageList(/^Dungeon Graphics - /).map(num => {
					return {
						text: imagesIndex[num].name,
						actionSelect: ['showImage', {num:num, palettes: imagesIndex[num].palettes || palettesInterface}],
						actionEnter: ['nextPalette'],
					};
				}),
			},
			imgDoor: {
				title: 'Doors',
				items: () => this.filterImageList(/^Door /).map(num => {
					return {
						text: imagesIndex[num].name,
						actionSelect: ['showImage', {num:num, palettes: imagesIndex[num].palettes || palettesInterface}],
						actionEnter: ['nextPalette'],
					};
				}),
			},
			imgWallOrnate: {
				title: 'Wall ornate',
				items: () => this.filterImageList(/^Wall Ornate /).map(num => {
					return {
						text: imagesIndex[num].name,
						actionSelect: ['showImage', {num:num, palettes: imagesIndex[num].palettes || palettesInterface}],
						actionEnter: ['nextPalette'],
					};
				}),
			},
			imgItemOnFloor: {
				title: 'Items on floor',
				items: () => this.filterImageList(/^Item on floor /).map(num => {
					return {
						text: imagesIndex[num].name,
						actionSelect: ['showImage', {num:num, palettes: imagesIndex[num].palettes || palettesInterface}],
						actionEnter: ['nextPalette'],
					};
				}),
			},
			imgCreatures: {
				title: 'Creatures',
				items: () => this.filterImageList(/^Creature /).map(num => {
					return {
						text: imagesIndex[num].name,
						actionSelect: ['showImage', {num:num, palettes: imagesIndex[num].palettes || palettesInterface}],
						actionEnter: ['nextPalette'],
					};
				}),
			},
			// Explosion
			// Missile
			imgInventoryitems: {
				title: 'Inventory items',
				items: [],
			},
			imgFonts: {
				title: 'Fonts',
				items: [],
			},
			sounds: {
				title: 'Sounds',
				items: () => {
					let newItems = [];
					// build items from portraits list
					for(let num in soundsIndex) {
						let snd = soundsIndex[num];
						(snd.rates || ratesDefault).forEach((rate, idx) => {
							newItems.push({
								text: snd.name + (snd.rates ? ` (${rate} Hz)` : ''),
								actionEnter: ['playSound', {num:num, rateIdx:idx}],
							});
						});
					}
					return newItems;
				},
			},
			maps: {
				title: 'Maps',
				items: [],
			},
			runtime: {
				title: 'Runtime',
				subtitle: 'inspect runtime structures',
				items: [
					{submenu: 'characters'},
				],
			},
			characters: {
				title: 'Characters data',
				items: [],
			}

		};
		this.menuStack = [];
		this.menuGoto('main');
		// swoosh ?
	}

	init(runner) {
		keys.loadBindings('menu');
		runner.refreshTime = 10;	// 100 refreshs per second, to have reactive menus
	}

	exit() {
		keys.unloadBindings('menu');
	}

	filterImageList(regexp) {
		let out = [];
		for (let num in imagesIndex)
			if (imagesIndex[num].name.match(regexp))
				out.push(num);
		return out;
	}


	menuGoto(name) {
		if (!this.menus[name])
			throw new Error(`Can't find a menu named '${name}'`);
		this.menuStack.push({
			menu: this.menus[name],
			idx: 0,
		});
		this.menuUpdateItems();
	}
	menuBack() {
		if (this.menuStack.length > 1)
			this.menuStack.pop();
		this.menuUpdateItems();
	}

	menuUpdateItems() {
		this.currentMenu = this.menuStack[this.menuStack.length-1];

		// build items list
		this.menuItems = [];
		if (!this.currentMenu.menu.items)
			throw new Error(`This menu has no items ! ${this.currentMenu.menu.title}`);
		if (this.currentMenu.menu.items.constructor === Array)
			this.menuItems = this.currentMenu.menu.items;
		else if (this.currentMenu.menu.items.constructor === Function)
			this.menuItems = this.currentMenu.menu.items();

		// build items names list
		this.menuItemNames = this.menuItems.map(entry => {
			if (entry.submenu)
				return this.menus[entry.submenu].title;
			else
				return entry.text;
		});
		this.showImage = null;
		this.actionSelect();
	}

	actionSelect() {
		let item = this.menuItems[this.currentMenu.idx];
		if (!item.actionSelect)
			return;
		switch(item.actionSelect[0]) {
			case 'showImage':
				this.showImage = item.actionSelect[1];
				this.currentMenu.paletteIdx = 0;
				break;
			default:
				break;				
		}
	}

	processInputs(runner, keyqueue) {
		// no mouse event managed, so return if no key event
		if (keyqueue.length === 0)
			return false;

		let redraw = false;
		let key = keyqueue.shift();
		// console.log(`got key input ${key}`);
		switch(key) {
			case 'menu left':
				// left goes back one level
				this.menuBack();
				redraw = true;
				break;
			case 'menu right':
				// right runs the action for the current item
				// console.log(JSON.stringify(this.menuItems));
				let item = this.menuItems[this.currentMenu.idx];
				if (!item)
					break;
				if (item.submenu) {
					// console.log(`enter submenu ${item.submenu}`);
					// enter submenu
					this.menuGoto(item.submenu);
					redraw = true;
				} else if (item.actionEnter) {
					switch(item.actionEnter[0]) {
						case 'goZone':
							runner.select('game');
							break;
						case 'playSound':
							screen.playSound(item.actionEnter[1].num, item.actionEnter[1].rateIdx);
							break;
						case 'nextPalette':
							this.currentMenu.paletteIdx += 1;
							redraw = true;
							break;
					}
				}
				break;
			case 'menu up':
				// move up menu entry
				this.currentMenu.idx = (this.currentMenu.idx-1 + this.menuItems.length) % this.menuItems.length;
				this.actionSelect();
				redraw = true;
				break;
			case 'menu down':
				// move down menu entry
				this.currentMenu.idx = (this.currentMenu.idx+1 + this.menuItems.length) % this.menuItems.length;
				this.actionSelect();
				redraw = true;
				break;
			case 'menu exit':
				runner.select('game');
				break;
			default:
				throw new Error(`no action for key '${key}'`);
		}
		return redraw;
	}
	runWorld() {
		// nothing to run in menus. background animation ?
	}
	drawView() {
		// console.log('draw');
		// background
		// screen.readAndExpandGraphic(4, 0, 0);
		// screen.fillRect(0, 30, 232, 141, 'black');
		// screen.readAndExpandGraphic(2, 0, 30);
		// screen.readAndExpandGraphic(3, 104, 30);

		// title
		screen.clear();
		screen.writeText(this.currentMenu.menu.title, 15, 45, null, 15);
		if (this.currentMenu.menu.subtitle)
			screen.writeText(this.currentMenu.menu.subtitle, 15, 60);

		// parent name (back hint)
		if (this.menuStack.length > 1){
			screen.fillTriangle([2, 75], [5, 72], [5, 78]);
			screen.writeText(this.menuStack[this.menuStack.length-2].menu.title, 10, 78, null, 8);
		}
		// middle: list items to select
		// list max 5 items, starting from idx and looping
		screen.fillTriangle([16, 92], [13, 89], [13, 95]);
		for (let i=0; i<7 && i<this.menuItems.length; i++)
			screen.writeText(this.menuItemNames[(this.currentMenu.idx+i)%this.menuItemNames.length], 20, 95 + i*15, null, 8);

		if (this.showImage) {
			if (this.showImage.collection) {
				screen.drawCollectionImage(this.showImage.collection, this.showImage.idx, 200, 80);
			} else if (this.showImage.num) {
				screen.readAndExpandGraphic(this.showImage.num, 200, 80, this.showImage.palettes[this.currentMenu.paletteIdx % this.showImage.palettes.length]);
			}
		}
	}
}
