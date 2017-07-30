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
	'move forward': 104,
	'move back': 98,
	'strafe left': 100,
	'strafe right': 102,
	'turn left': 103,
	'turn right': 105,
	'spell char 1': 112,
	'spell char 2': 113,
	'spell char 3': 114,
	'spell char 4': 115,
	'spell symbol 1': 49,
	'spell symbol 2': 50,
	'spell symbol 3': 51,
	'spell symbol 4': 52,
	'spell symbol 5': 53,
	'spell symbol 6': 54,
};

const keyGroups = {
	'menu': [
		'switch debug',
	],
	'debug': [
		'debug up',
		'debug down',
		'debug enter',
		'debug leave',
		'debug next',
		'debug previous',
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

		let keylist = this.activekeys;
		window.onkeydown = event => {
			this.processKey(event, keylist);
		};
	}

	readKeySetup() {
		// localStorage read
	}
	saveKeySetup() {
		// localStorage store this.keyBindings
	}

	setup(template) {
	}

	processKey(event) {
		console.log(event.keyCode);
		event.preventDefault();
	}
}
