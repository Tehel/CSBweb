'use strict';

const keyNames = {
	0: 'quote',

	8: 'backspace',
	9: 'tab',

	12: 'num pad center',
	13: 'enter',

	16: 'shift',
	17: 'ctrl',
	18: 'alt',
	19: 'pause',
	20: 'caps lock',

	27: 'esc',
	32: 'space',
	33: 'page up',
	34: 'page down',
	35: 'end',
	36: 'home',
	37: 'arrow left',
	38: 'arrow up',
	39: 'arrow right',
	40: 'arrow down',

	45: 'ins',
	46: 'del',

	48: '0',
	49: '1',
	50: '2',
	51: '3',
	52: '4',
	53: '5',
	54: '6',
	55: '7',
	56: '8',
	57: '9',
	59: ';',
	61: '=',

	65: 'A',
	66: 'B',
	67: 'C',
	68: 'D',
	69: 'E',
	70: 'F',
	71: 'G',
	72: 'H',
	73: 'I',
	74: 'J',
	75: 'K',
	76: 'L',
	77: 'M',
	78: 'N',
	79: 'O',
	80: 'P',
	81: 'Q',
	82: 'R',
	83: 'S',
	84: 'T',
	85: 'U',
	86: 'V',
	87: 'W',
	88: 'X',
	89: 'Y',
	90: 'Z',

	96: 'num pad 0',
	97: 'num pad 1',
	98: 'num pad 2',
	99: 'num pad 3',
	100: 'num pad 4',
	101: 'num pad 5',
	102: 'num pad 6',
	103: 'num pad 7',
	104: 'num pad 8',
	105: 'num pad 9',
	106: 'num pad *',
	107: 'num pad +',
	109: 'num pad -',
	110: 'num pad .',
	111: 'num pad /',
	112: 'F1',
	113: 'F2',
	114: 'F3',
	115: 'F4',
	116: 'F5',
	117: 'F6',
	118: 'F7',
	119: 'F8',
	120: 'F9',
	121: 'F10',
	122: 'F11',
	123: 'F12',

	144: 'num lock',
	145: 'scroll lock',
	173: '-',
	188: ',',
	190: '.',
	191: '/',
	219: '[',
	220: '\\',
	221: ']',
	225: 'alt gr',
}

const keyActions = {
	'move forward': 'num pad 8',
	'move back': 'num pad 2',
	'strafe left': 'num pad 4',
	'strafe right': 'num pad 6',
	'turn left': 'num pad 7',
	'turn right': 'num pad 9',
	'spell char 1': 'F1',
	'spell char 2': 'F2',
	'spell char 3': 'F3',
	'spell char 4': 'F4',
	'spell symbol 1': '1',
	'spell symbol 2': '2',
	'spell symbol 3': '3',
	'spell symbol 4': '4',
	'spell symbol 5': '5',
	'spell symbol 6': '6',
	'to menu': 'esc',
	'menu up': 'arrow up',
	'menu down': 'arrow down',
	'menu left': 'arrow left',
	'menu right': 'arrow right',
	'menu exit': 'esc',
};

const keyGroups = {
	'menu': [
		'menu up',
		'menu down',
		'menu left',
		'menu right',
		'menu exit',
	],
	'meta': [
		'to menu',
	],
	'movement':[
		'move forward',
		'move back',
		'strafe left',
		'strafe right',
		'turn left',
		'turn right',
	],
	'spells':[
		'spell char 1',
		'spell char 2',
		'spell char 3',
		'spell char 4',
		'spell symbol 1',
		'spell symbol 2',
		'spell symbol 3',
		'spell symbol 4',
		'spell symbol 5',
		'spell symbol 6',
	],
	'attack':[
	],
	'inventories':[
	],
};

class Keys {
	constructor() {

		this.activekeys = [];
		this.keyBindings = {};
		this.queue = [];

		let keylist = this.activekeys;
		window.onkeydown = event => {
			this.processKey(event, keylist);
		};
	}

	readKeyActions() {
		// localStorage read
	}
	saveKeyActions() {
		// localStorage store this.keyBindings
	}

	loadBindings(name) {
		// console.log(`Loading bindings for ${name}`);
		let group = keyGroups[name];
		if (!group)
			throw new Error(`Unknown keybiding group ${name}`);
		for (let action of group) {
			let key = keyActions[action];
			if (key) {
				// check for conflicts
				if (this.keyBindings[key])
					throw new Error(`Can't bind key ${key} to ${action}, already used for ${this.keyBindings[key]}`);
				// console.log(`\tkey ${key} to action ${action}`);
				this.keyBindings[key] = action;
			} // else no key defined for this action
		}
	}
	unloadBindings(name) {
		// console.log(`Unloading bindings for ${name}`);
		let group = keyGroups[name];
		for (let action of group || []) {
			let key = keyActions[action];
			if (key)
				delete this.keyBindings[key];
		}
	}

	clearQueue() {
		this.queue = [];
	}

	processKey(event) {
		let keyname = null;
		if (typeof event === 'object') {
			keyname = keyNames[event.keyCode];
			if (!keyname) {
				console.log(`Key ${code} has no name ?!?`);
				return;
			}
		} else {
			keyname = event;
		}

		// check if the key was assigned, if not, let it go through
		if (this.keyBindings[keyname]) {
			this.queue.push(this.keyBindings[keyname]);
			if (event.preventDefault)
				event.preventDefault();
			// console.log(`Key ${code} (${keyname}) is assigned to ${this.keyBindings[keyname]}`);
		}
	}
}
