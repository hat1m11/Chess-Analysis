// Small DOM helpers. API data only ever reaches the page as text nodes or properties.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  node.append(...children.flat(Infinity).filter(Boolean));
  return node;
}

// A stroke icon drawn from a single SVG path on a 24-unit grid.
export const icon = (path) => svg("svg", { class: "icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: path }));

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith("aria-") || key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
}

// Book notation: "Nf3" -> "♞f3". Only matches piece letters that begin a move.
const FIGURINES = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
export const figurine = (text) =>
  text.replace(/\b([KQRBN])(?=[a-h1-8]?x?[a-h][1-8])/g, (_, piece) => `${FIGURINES[piece]}︎`);

export const capitalize =(text) => text.charAt(0).toUpperCase() + text.slice(1);
export const safeLink = (url) => (/^https:\/\/(www\.)?chess\.com\//.test(url ?? "") ? url : null);
