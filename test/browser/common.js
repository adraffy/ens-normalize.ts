// helpers shared by the browser test pages

/** create an element: el('td', {class: 'num'}, 'text', child, ...) */
export function el(tag, attrs = {}, ...children) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
	}
	e.append(...children.flat().filter((x) => x !== undefined && x !== null));
	return e;
}

export const hexSeq = (s) => Array.from(s, (c) => c.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ');

export async function fetchJSON(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res.json();
}

/** yield to the browser so the page stays responsive */
export const tick = () => new Promise((resolve) => setTimeout(resolve));

/** a button that downloads `data` as a JSON file */
export function downloadButton(name, data) {
	const b = el('button', {}, `Download ${name}`);
	b.onclick = () => {
		const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' })), download: name });
		a.click();
		URL.revokeObjectURL(a.href);
	};
	return b;
}

export function setStatus(node, state, text) {
	node.className = `status ${state}`;
	node.replaceChildren(el('span', { class: 'icon' }, { pass: '✅', fail: '❌', wait: '⏳' }[state]), el('span', {}, ...[text].flat()));
}
