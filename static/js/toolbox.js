
//--------------------------- gestion des requêtes XMLHTTPRequest ---------------------------

class Server {
	constructor() {
		// nothing, this class is just a function holder
	}

	// headers: a hash, like: {Accept: 'application/json'}
	sendRequest(method, url, content, headers) {
		return new Promise((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.open(method, url, true);

			// because 'typeof null' => 'object'
			if (content === null) {
				content = undefined;
			}
			let contentStr = null;
			switch (typeof content) {
				case 'string':
					contentStr = new TextEncoder('utf-8').encode(content);
					request.setRequestHeader('Content-type', 'text/plain');
					break;
				case 'number':
					contentStr = new TextEncoder('utf-8').encode(content.toString(10));
					request.setRequestHeader('Content-type', 'text/plain');
					break;
				case 'object':
					contentStr = new TextEncoder('utf-8').encode(JSON.stringify(content));
					request.setRequestHeader('Content-type', 'application/json');
					break;
				default:
					// no content, no header
					contentStr = '';
					break;
			}
			if (typeof content === 'object') {
				request.setRequestHeader('Content-size', contentStr.length);
			}

			// copy custom headers
			for (let header in (headers || {})) {
				// filter out "responseType", as it's not really a header, it only has a local role
				if (header === 'responseType') {
					request.responseType = headers[header];
				} else {
					request.setRequestHeader(header, headers[header]);
				}
			}

			request.onload = () => {
				resolve(request.response);
			};
			request.onerror = (evnt) => {
				reject(`query to ${url} failed with status ${evnt.type}`);
			};
			request.send(contentStr);
		});
	}
	get(url, headers) { return this.sendRequest('GET', url, null, headers); }
	delete(url, headers) { return this.sendRequest('DELETE', url, null, headers); }
	options(url, headers) { return this.sendRequest('OPTIONS', url, null, headers); }
	post(url, content, headers) { return this.sendRequest('POST', url, content, headers); }
	put(url, content, headers) { return this.sendRequest('PUT', url, content, headers); }
	patch(url, content, headers) { return this.sendRequest('PATCH', url, content, headers); }
}

//--------------------------- page data access ---------------------------

function $(id) {
	let it = window[id];
	if (it) {
		//alert(id + ' exists in window');
		let type = typeof it;
		if (type == 'object') {
			//alert(id + ' is an Object');
			let str = it.toString();
			if (str != '[object Window]') {
				//alert(id + ' and not a window');
				return it;
			}
		}
	}
	return document.getElementById(id);
}

function getEvent(evnt) { if (evnt == undefined) return window.event; return evnt; }
function getTarget(evnt) { if (evnt.target) return evnt.target; return evnt.srcElement; }

//--------------------------- debug tracer ---------------------------

function trace(text) {
	var elem = $('trace')
	if (elem == null) {
		elem = document.createElement('div')
		elem.id = 'trace'
		document.body.appendChild(elem)
		elem.innerHTML = '<input id="trace_toggle" type="button" value=" "><div id="trace_block"><input id="trace_clear" type="button" value="Clear"><input id="trace_remove" type="button" value="Remove"><br><textarea id="trace_text" cols="160" rows="30" spellcheck="false"></textarea></div>'
		$('trace_clear').addEventListener('click', trace_clear)
		$('trace_remove').addEventListener('click', trace_remove)
		$('trace_toggle').addEventListener('click', trace_toggle)
	}
	$('trace_text').textContent += text + '\n'
	$('trace_block').style.display = 'none'
}

function trace_toggle() {
	var state = $('trace_block').style.display
	var newstate = state == 'none' ? 'inherit' : 'none'
	$('trace_block').style.display = newstate
}

function trace_clear() {
	$('trace').lastChild.textContent = '';
}

function trace_remove() {
	document.body.removeChild($('trace'));
}

/* This is much faster than using (el.innerHTML = str) when there are many
existing descendants, because in some browsers, innerHTML spends much longer
removing existing elements than it does creating new ones.
syntax: el = replaceHtml(el, html)

source:  http://blog.stevenlevithan.com/archives/faster-than-innerhtml
*/

function replaceHtml(el, html) {
	var oldEl = typeof el === "string" ? document.getElementById(el) : el;
	var newEl = oldEl.cloneNode(false);
	// Replace the old with the new
	newEl.innerHTML = html;
	oldEl.parentNode.replaceChild(newEl, oldEl);
	/* Since we just removed the old element from the DOM, return a reference
	to the new element, which can be used to restore variable references. */
	return newEl;
}

function emptyElement(el) {
	while (el.firstChild != null)
		el.removeChild(el.firstChild);
}

//--------------------------- events management ---------------------------
/*
function addListener(obj, type, func)
{
	if (obj.eventsFunc == null) obj.eventsFunc = {};
	obj.eventsFunc.type = func;
	obj.addEventListener(type, func, false);
}

function removeListener(obj, type)
{
	obj.removeEventListener(type, obj.eventsFunc.type, false);
	delete obj.eventsFunc.type;
}
*/
//--------------------------- Local storage ---------------------------

class Store {
	show(prefix) {
		if (!prefix) prefix = '';
		let prefixlen = prefix.length;

		let store = localStorage;
		let str = '';
		for (let i=0; i<store.length; i++) {
			let key = store.key(i);
			if (key.substr(0, prefixlen) === prefix)
				str += key + ' : ' + store.getItem(key).length + '\n';
		}
		return str;
	}
	clear(prefix) {
		if (!prefix) prefix = '';
		let prefixlen = prefix.length;

		let store = localStorage;
		for (let i=store.length-1; i>= 0; i--) {
			let key = store.key(i);
			if (key.substr(0, prefixlen) === prefix)
				store.removeItem(key);
		}
	}
	clearall() {
		if (confirm('Really completely empty LocalStorage ?'))
			localStorage.clear();
	}
};

//--------------------------- Oriented object extensions ---------------------------

// returns -1 if a < b, +1 if a > b, 0 if equal. Try to compare numerically if both are numbers, or strings containing numbers
function cmp(a, b) {
	if (a == undefined) a = '';		// replace undefined (not sortable) by an empty string
	if (b == undefined) b = '';
	let ai = (a.constructor === Number) ? a : parseInt(a);	// try to extract a numerical value
	let bi = (a.constructor === Number) ? b : parseInt(b);
	if (!isNaN(ai) && !isNaN(bi)){
		return ai < bi ? -1 : ai > bi ? 1 : 0;
	} else {
		return a < b ? -1 : a > b ? 1 : 0;
	}
}

// fields is a list of field names that we'll compare
function cmpobj(a, b, fields) {
	let res = 0;
	fields.some(field => {
		res = cmp(a[field], b[field]);
		return res !== 0;
	});
	return res;
}

// make a complete copy of a structure
function deepCopy(obj) {
	if (obj.constructor === Array) {
		return obj.map(it => deepCopy(it));
	} else if (typeof obj === 'object') {
		let out = {};
		for (let name in obj) {
			out[name] = deepCopy(obj[name]);
		}
		return out;
	} else {
		return obj;
	}
}

// simple json-like serialization for trace dump (no handling of embedded ")
function toStr(obj, pretty, maxdepth, path, refs) {
	let extarr = (arr, arg) => {
		let newa = deepCopy(arr);
		newa.push(arg);
		return newa;
	}

	if (maxdepth == undefined) maxdepth = 2;
	if (path == undefined) path = [];
	if (refs == undefined) refs = {};
	if (refs[obj]) return refs[obj];
	if (path.length > maxdepth) return '* too deep *';
	refs[obj] = `*${path.join('>')}*`;

	let tabs = '\t'.repeat(path.length);
	let str = '';
	if (obj.constructor === Array) {
		let out = [];
		for (let i = 0; i < obj.length; i++)
			out.push(toStr(obj[i], pretty, maxdepth, extarr(path, i), refs));
		if (pretty) {
			str += `[\n\t${tabs}${out.join(`,\n\t${tabs}\t`)}\n${tabs}]`;
		} else {
			str += `[${out.join(',')}]`;
		}
	} else if (typeof obj === 'object') {
		let out = []
		for (let i in obj) {
			out.push(`"${i}":${toStr(obj[i], pretty, maxdepth, extarr(path, i), refs)}`);
		}
		if (pretty){
			str += `{\n\t${tabs}${out.join(`,\n\t${tabs}`)}\n${tabs}}`;
		} else {
			str += `{${out.join(',')}}`;
		}
	} else if (typeof obj === 'function') {
		str += '* function *';
	} else if (obj == undefined) {
		str += 'undefined';
	} else {
		str += obj.toString();
	}
	return str;
}		
