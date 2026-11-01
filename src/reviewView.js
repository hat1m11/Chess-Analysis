// The game review screen: board, evaluation graph, verdict and a tabbed side panel.
import { Chess } from "chess.js";

import { capitalize, el, figurine, icon, safeLink, svg } from "./dom.js";
import { buildReview, CLASSIFICATIONS, parseGame } from "./review.js";

const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const FILES = "abcdefgh";
const KEY_MOMENTS = new Set(["great", "mistake", "blunder"]);
const SCORESHEET_GLYPHS = new Set(["great", "inaccuracy", "mistake", "blunder"]);
const BAND = { width: 1000, height: 100 };
const TABS = [
  ["moments", "Key moments"],
  ["moves", "All moves"],
  ["stats", "Stats"],
];
const ICONS = {
  first: "M18 6l-6 6 6 6M8 6v12",
  previous: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  last: "M6 6l6 6-6 6M16 6v12",
  back: "M15 6l-6 6 6 6",
  external: "M8 16L17 7M9 7h8v8",
};

function squareCentre(square, orientation) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { x: file + 0.5, y: 7.5 - rank } : { x: 7.5 - file, y: rank + 0.5 };
}

function renderBoard(fen, move, orientation, label) {
  const rows = new Chess(fen).board();
  const order = [0, 1, 2, 3, 4, 5, 6, 7];
  const ranks = orientation === "white" ? order : [...order].reverse();
  const files = orientation === "white" ? order : [...order].reverse();
  const squares = [];

  ranks.forEach((row, rowIndex) => {
    files.forEach((file, fileIndex) => {
      const name = `${FILES[file]}${8 - row}`;
      const piece = rows[row][file];
      const isLight = (row + file) % 2 === 0;
      const highlighted = move && (name === move.from || name === move.to);
      squares.push(
        el(
          "div",
          { className: `square ${isLight ? "light" : "dark"}${highlighted ? " highlighted" : ""}` },
          fileIndex === 0 ? el("span", { className: "coord rank", textContent: 8 - row }) : null,
          rowIndex === 7 ? el("span", { className: "coord file", textContent: FILES[file] }) : null,
          piece ? el("piece", { className: `${PIECE_NAMES[piece.type]} ${piece.color === "w" ? "white" : "black"}` }) : null,
          move?.classification && name === move.to
            ? el("span", { className: `square-badge class-${move.classification}`, textContent: CLASSIFICATIONS[move.classification].glyph })
            : null,
        ),
      );
    });
  });

  const showBest = move?.bestUci && !["best", "great"].includes(move.classification);
  let arrow = null;
  if (showBest) {
    const from = squareCentre(move.bestUci.slice(0, 2), orientation);
    const to = squareCentre(move.bestUci.slice(2, 4), orientation);
    arrow = svg(
      "svg",
      { class: "board-arrow", viewBox: "0 0 8 8", "aria-hidden": "true" },
      svg("defs", {}, svg("marker", { id: "arrow-head", markerWidth: 3, markerHeight: 3, refX: 1.8, refY: 1.5, orient: "auto" }, svg("path", { d: "M0,0 L3,1.5 L0,3 Z", class: "arrow-head" }))),
      svg("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "arrow-line", "marker-end": "url(#arrow-head)" }),
    );
  }

  return el("div", { className: "board cg-wrap", role: "img", "aria-label": label }, squares, arrow);
}

function renderEvalBar(position, orientation) {
  const chance = position ? position.whiteChance : 50;
  return el(
    "div",
    { className: `eval-bar ${orientation === "black" ? "flipped" : ""}`, role: "img", "aria-label": position ? `Evaluation ${position.evalText}` : "Evaluation pending" },
    el("div", { className: "eval-white", style: `height:${chance}%` }),
  );
}

function moveName(move) {
  return `${move.moveNumber}${move.color === "white" ? "." : "..."} ${move.san}`;
}

function renderBand(review, currentPly, goTo) {
  const { positions, moves } = review;
  const count = positions.length - 1;
  const xFor = (ply) => (count === 0 ? 0 : (ply / count) * BAND.width);
  const yFor = (chance) => BAND.height - (chance / 100) * BAND.height;

  const known = positions.map((position, ply) => (position ? { ply, chance: position.whiteChance } : null)).filter(Boolean);
  const line = known.map(({ ply, chance }, index) => `${index === 0 ? "M" : "L"}${xFor(ply).toFixed(1)},${yFor(chance).toFixed(1)}`).join(" ");
  const area = known.length ? `${line} L${xFor(known.at(-1).ply).toFixed(1)},${BAND.height} L0,${BAND.height} Z` : "";

  // Markers are HTML, because the stretched SVG would squash circles into ovals.
  const markers = moves
    .filter((move) => KEY_MOMENTS.has(move.classification) && positions[move.ply])
    .map((move) =>
      el("span", {
        className: `band-marker class-${move.classification}`,
        style: `left:${(move.ply / count) * 100}%;top:${100 - positions[move.ply].whiteChance}%`,
      }),
    );

  const hoverLine = svg("line", { y1: 0, y2: BAND.height, class: "band-hover", visibility: "hidden" });
  const tooltip = el("div", { className: "band-tooltip", hidden: true });
  const chart = svg(
    "svg",
    { viewBox: `0 0 ${BAND.width} ${BAND.height}`, preserveAspectRatio: "none", class: "band-svg", "aria-hidden": "true" },
    svg("path", { d: area, class: "band-area" }),
    svg("line", { x1: 0, x2: BAND.width, y1: BAND.height / 2, y2: BAND.height / 2, class: "band-mid" }),
    svg("line", { x1: xFor(currentPly), x2: xFor(currentPly), y1: 0, y2: BAND.height, class: "band-current" }),
    hoverLine,
  );

  const band = el("div", { className: "band", title: "Higher means better for White. Select a point to go to that move." }, chart, markers, tooltip);
  const plyAt = (event) => {
    const rect = chart.getBoundingClientRect();
    return Math.max(0, Math.min(count, Math.round(((event.clientX - rect.left) / rect.width) * count)));
  };
  band.addEventListener("pointermove", (event) => {
    const ply = plyAt(event);
    const move = moves[ply - 1];
    const evalText = positions[ply]?.evalText ?? "not checked yet";
    hoverLine.setAttribute("x1", xFor(ply));
    hoverLine.setAttribute("x2", xFor(ply));
    hoverLine.setAttribute("visibility", "visible");
    const verdict = move?.classification ? `, ${CLASSIFICATIONS[move.classification].label.toLowerCase()}` : "";
    tooltip.textContent = move ? `${figurine(moveName(move))}, ${evalText}${verdict}` : `Start, ${evalText}`;
    tooltip.hidden = false;
    const share = count === 0 ? 0 : ply / count;
    tooltip.style.left = `${share * 100}%`;
    tooltip.style.transform = `translateX(${-share * 100}%)`;
  });
  band.addEventListener("pointerleave", () => {
    hoverLine.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
  band.addEventListener("click", (event) => goTo(plyAt(event)));
  return band;
}

function renderPlayers(summary, review) {
  const sides = [
    { name: summary.username, rating: summary.rating, color: summary.color },
    { name: summary.opponent.username, rating: summary.opponent.rating, color: summary.color === "white" ? "black" : "white" },
  ];
  return el(
    "div",
    { className: "players", "aria-label": "Players, Elo and accuracy in this game" },
    sides.map((side) => {
      const { accuracy } = review[side.color];
      return el(
        "div",
        { className: "player-row" },
        el("span", { className: `color-chip ${side.color}`, title: capitalize(side.color) }),
        el("b", {}, side.name, el("span", { textContent: side.rating })),
        el("span", { className: "player-accuracy", title: "Accuracy", textContent: accuracy === null ? "" : `${accuracy.toFixed(1)}%` }),
      );
    }),
    el("p", { className: "accuracy-note", textContent: "Accuracy from this review" }),
  );
}

function renderVerdict(move, position) {
  if (!move) {
    return el("div", { className: "verdict" }, el("div", { className: "verdict-head" }, el("span", { className: "verdict-move", textContent: "Starting position" })), el("p", { className: "muted", textContent: "Select Next key moment to jump to the turning points, or step through with the arrows." }));
  }
  if (!move.classification) {
    return el(
      "div",
      { className: "verdict" },
      el("div", { className: "verdict-head" }, el("span", { className: "verdict-move", textContent: figurine(moveName(move)) })),
      el("p", { className: "muted", textContent: "Stockfish hasn't checked this move yet." }),
    );
  }
  const { label } = CLASSIFICATIONS[move.classification];
  return el(
    "div",
    { className: `verdict class-${move.classification}` },
    el(
      "div",
      { className: "verdict-head" },
      el("span", { className: "verdict-move", textContent: figurine(moveName(move)) }),
      el("span", { className: "verdict-label", textContent: label }),
      el("span", { className: "verdict-eval", title: "Evaluation from White's side", textContent: position?.evalText ?? "" }),
    ),
    el("p", { textContent: figurine(move.comment) }),
  );
}

function renderKeyMoments(review, summary, goTo, currentPly) {
  const moments = review.moves.filter((move) => move.color === summary.color && KEY_MOMENTS.has(move.classification));
  if (moments.length === 0) {
    const text = review.isComplete
      ? `${summary.username} played no great moves, mistakes or blunders in this game.`
      : `Great moves, mistakes and blunders by ${summary.username} appear here as Stockfish finds them.`;
    return el("p", { className: "empty-note", textContent: text });
  }
  return el(
    "ul",
    { className: "moments" },
    moments.map((move) =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", className: `moment class-${move.classification}${move.ply === currentPly ? " current" : ""}`, "data-focus": `moment-${move.ply}`, onclick: () => goTo(move.ply) },
          el("span", { className: "moment-move", textContent: figurine(moveName(move)) }),
          el("span", { className: "moment-label", textContent: CLASSIFICATIONS[move.classification].label }),
          move.bestSan && move.classification !== "great" ? el("span", { className: "muted", textContent: figurine(`Best: ${move.bestSan}`) }) : null,
        ),
      ),
    ),
  );
}

function renderMoveList(review, currentPly, goTo) {
  const rows = [];
  for (let index = 0; index < review.moves.length; index += 2) {
    const cell = (move) => {
      if (!move) return el("span");
      const annotated = SCORESHEET_GLYPHS.has(move.classification);
      return el(
        "button",
        {
          type: "button",
          className: `move-button${move.classification ? ` class-${move.classification}` : ""}${move.ply === currentPly ? " current" : ""}`,
          "data-focus": `move-${move.ply}`,
          onclick: () => goTo(move.ply),
          "aria-current": move.ply === currentPly ? "true" : null,
          "aria-label": `${moveName(move)}${move.classification ? `, ${CLASSIFICATIONS[move.classification].label}` : ""}`,
        },
        figurine(move.san),
        annotated ? el("span", { className: "glyph", textContent: CLASSIFICATIONS[move.classification].glyph, "aria-hidden": "true" }) : null,
      );
    };
    rows.push(el("li", { className: "move-row" }, el("span", { className: "move-number", textContent: review.moves[index].moveNumber }), cell(review.moves[index]), cell(review.moves[index + 1])));
  }
  return el("ol", { className: "move-list" }, rows);
}

function renderStats(summary, review) {
  const sides = [
    { name: summary.username, color: summary.color, chessCom: summary.accuracy },
    { name: summary.opponent.username, color: summary.color === "white" ? "black" : "white", chessCom: summary.opponentAccuracy },
  ];
  const row = (label, values) => el("tr", {}, el("th", { scope: "row" }, label), values.map((value) => el("td", { className: "num", textContent: value })));
  return el(
    "table",
    { className: "compare" },
    el("caption", { className: "visually-hidden", textContent: "How the two players compare in this game" }),
    el("thead", {}, el("tr", {}, el("td", {}), sides.map((side) => el("th", { scope: "col", className: "num", textContent: side.name })))),
    el(
      "tbody",
      {},
      Object.entries(CLASSIFICATIONS).map(([key, { label, glyph }]) =>
        row([el("span", { className: `glyph class-${key}`, textContent: glyph, "aria-hidden": "true" }), label], sides.map((side) => review[side.color].counts[key])),
      ),
      sides.some((side) => side.chessCom !== null) ? row("Chess.com accuracy", sides.map((side) => (side.chessCom === null ? "None" : `${side.chessCom.toFixed(1)}%`))) : null,
    ),
  );
}

// Opens a review inside `container`. Returns a function that closes it. Engine results are
// kept in `analyses`, so leaving and returning to a game resumes where it stopped.
export function openReview({ container, summary, analyses, getEngine, onBack, onProgress }) {
  const game = parseGame(summary.pgn, summary.startFen);
  const fens = [game.startFen, ...game.moves.map((move) => move.fenAfter)];
  let ply = 0;
  let tab = "moments";
  let closed = false;
  let engineError = null;
  let latestReview = null;

  const top = el(
    "div",
    { className: "review-top" },
    el("button", { type: "button", className: "quiet", onclick: onBack }, icon(ICONS.back), el("span", { className: "label", textContent: "All games" })),
    el("div", { className: "review-title" }, `${summary.username} vs ${summary.opponent.username}`, el("span", { textContent: `, ${summary.timeClass}` })),
    safeLink(summary.url)
      ? el("a", { href: summary.url, target: "_blank", rel: "noopener noreferrer", className: "quiet", "aria-label": "Open on Chess.com" }, el("span", { className: "label", textContent: "Chess.com" }), icon(ICONS.external))
      : null,
  );
  const progressBar = el("div", {});
  const progress = el("div", { className: "progress-track", role: "progressbar", "aria-label": "Stockfish is checking this game", "aria-valuemin": 0, "aria-valuemax": fens.length }, progressBar);
  const boardArea = el("div", { className: "board-area" });
  const bandArea = el("div", {});
  const playersArea = el("div", {});
  const verdictArea = el("div", { "aria-live": "polite" });
  const tabPanel = el("div", { className: "tab-panel" });
  const tabButtons = TABS.map(([name, label]) =>
    el("button", {
      type: "button",
      className: "tab",
      textContent: label,
      onclick: () => {
        tab = name;
        render();
      },
    }),
  );

  const goTo = (target) => {
    ply = Math.max(0, Math.min(game.moves.length, target));
    render();
  };
  const controlButton = (label, path, target) => {
    const button = el("button", { type: "button", className: "control", "aria-label": label, title: label, onclick: () => goTo(target()) }, icon(path));
    return button;
  };
  const nextKeyMoment = () =>
    latestReview?.moves.find((move) => move.ply > ply && move.color === summary.color && KEY_MOMENTS.has(move.classification));
  const nextMomentButton = el("button", {
    type: "button",
    className: "primary next-moment",
    textContent: "Next key moment",
    onclick: () => {
      const move = nextKeyMoment();
      if (move) {
        tab = "moments";
        goTo(move.ply);
      }
    },
  });
  const controls = el(
    "div",
    { className: "controls" },
    controlButton("First move", ICONS.first, () => 0),
    controlButton("Previous move", ICONS.previous, () => ply - 1),
    controlButton("Next move", ICONS.next, () => ply + 1),
    controlButton("Last move", ICONS.last, () => game.moves.length),
    el("span", { className: "key-hint", textContent: "or use ← → keys" }),
    nextMomentButton,
  );

  container.replaceChildren(
    top,
    progress,
    el(
      "div",
      { className: "review-layout" },
      el("div", { className: "stage" }, boardArea, bandArea, controls),
      el("div", { className: "panel" }, playersArea, verdictArea, el("div", { className: "tabs", role: "group", "aria-label": "Panel view" }, tabButtons), tabPanel),
    ),
  );

  function renderProgress(review) {
    const done = analyses.filter(Boolean).length;
    progress.hidden = review.isComplete && !engineError;
    progress.setAttribute("aria-valuenow", done);
    progressBar.style.width = `${(done / fens.length) * 100}%`;
  }

  function render() {
    const review = buildReview(game, analyses);
    latestReview = review;
    const move = ply > 0 ? review.moves[ply - 1] : null;
    const boardLabel = move ? `Board after ${moveName(move)}` : "Board at the start of the game";
    // Redrawing replaces these buttons, so keyboard focus has to be carried across.
    const focusKey = document.activeElement?.dataset?.focus;

    boardArea.replaceChildren(renderEvalBar(review.positions[ply], summary.color), renderBoard(fens[ply], move, summary.color, boardLabel));
    bandArea.replaceChildren(renderBand(review, ply, goTo));
    playersArea.replaceChildren(renderPlayers(summary, review));
    verdictArea.replaceChildren(engineError ? el("div", { className: "verdict" }, el("p", { textContent: engineError })) : renderVerdict(move, review.positions[ply]));

    const scrollTop = tabPanel.scrollTop;
    const views = { moments: () => renderKeyMoments(review, summary, goTo, ply), moves: () => renderMoveList(review, ply, goTo), stats: () => renderStats(summary, review) };
    tabPanel.replaceChildren(views[tab]());
    tabPanel.scrollTop = scrollTop;
    TABS.forEach(([name], index) => tabButtons[index].setAttribute("aria-pressed", String(name === tab)));

    const current = tabPanel.querySelector(".current");
    if (current) {
      const panelRect = tabPanel.getBoundingClientRect();
      const rect = current.getBoundingClientRect();
      if (rect.top < panelRect.top || rect.bottom > panelRect.bottom) tabPanel.scrollTop += rect.top - panelRect.top - panelRect.height / 2;
    }
    if (focusKey) tabPanel.querySelector(`[data-focus="${focusKey}"]`)?.focus();

    const upcoming = nextKeyMoment();
    nextMomentButton.disabled = !upcoming;
    nextMomentButton.textContent = upcoming || !review.isComplete ? "Next key moment" : "No more key moments";
    renderProgress(review);
  }

  function onKeyDown(event) {
    if (event.target.matches?.("input, textarea")) return;
    const targets = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: game.moves.length };
    if (event.key in targets) {
      event.preventDefault();
      goTo(targets[event.key]);
    }
  }
  document.addEventListener("keydown", onKeyDown);

  async function analyseRemaining() {
    try {
      const engine = getEngine();
      for (let index = 0; index < fens.length; index += 1) {
        if (analyses[index]) continue;
        const result = await engine.analyse(fens[index]);
        if (closed) return;
        analyses[index] = result;
        // Redrawing every position is wasted work; a steady trickle keeps it feeling live.
        if (index % 4 === 0 || index === fens.length - 1) render();
      }
      render();
      onProgress?.();
    } catch (error) {
      if (closed) return;
      console.error(error);
      engineError = "Stockfish couldn't start, so moves can't be judged. You can still go through the game. Reload the page to try again.";
      render();
    }
  }

  render();
  analyseRemaining();

  return () => {
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    // Drops the search in progress. Its result is discarded, so it's never saved half-done.
    try {
      getEngine.current?.stop();
    } catch {
      // The worker may already be gone; nothing to stop.
    }
  };
}
