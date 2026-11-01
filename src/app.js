import { buildOverview, summarizeGame, summarizeRatings } from "./analysis.js";
import { fetchPlayer, fetchRecentGames, fetchStats, parseUsername } from "./chesscom.js";
import { capitalize, el, icon, safeLink } from "./dom.js";
import { Engine } from "./engine.js";
import { buildReview, parseGame } from "./review.js";
import { openReview } from "./reviewView.js";

const GAME_COUNT = 5;
const RESULT_WORDS = { win: "Won", draw: "Drew", loss: "Lost" };
const SAMPLE_PLAYERS = ["hikaru", "magnuscarlsen", "gothamchess"];

const form = document.querySelector("#search-form");
const input = document.querySelector("#username");
const submitButton = form.querySelector("button");
const statusEl = document.querySelector("#status");
const homeEl = document.querySelector("#home");
const profileEl = document.querySelector("#profile");
const resultsEl = document.querySelector("#results");
const reviewEl = document.querySelector("#review");
const samplesEl = document.querySelector("#samples");

let latestSearch = 0;
let closeReview = null;
// Each game's engine results by URL, so reopening a game doesn't start over.
const analysesByGame = new Map();
let current = null;

function getEngine() {
  getEngine.current ??= new Engine();
  return getEngine.current;
}

function formatDate(seconds) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const countOf = (count, noun, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;

function renderRatings(ratings) {
  if (ratings.length === 0) return null;
  return el(
    "dl",
    { className: "ratings", "aria-label": "Current Elo by format" },
    ratings.map(({ format, rating, best }) =>
      el(
        "div",
        {},
        el("dt", { textContent: format }),
        el("dd", {}, String(rating), best ? el("span", { className: "peak", textContent: `Peak ${best}` }) : null),
      ),
    ),
  );
}

function renderProfile(player, ratings) {
  const country = player.country?.split("/").pop();
  const identity = [player.name, country].filter(Boolean).join(", ");
  const avatar = /^https:\/\//.test(player.avatar ?? "") ? el("img", { className: "avatar", src: player.avatar, alt: "" }) : el("div", { className: "avatar" });
  const profileUrl = safeLink(player.url);

  return [
    el(
      "section",
      { className: "profile", "aria-label": "Player" },
      avatar,
      el(
        "div",
        { className: "profile-text" },
        el(
          "h2",
          {},
          player.title ? el("span", { className: "title-badge", textContent: player.title }) : null,
          profileUrl ? el("a", { href: profileUrl, target: "_blank", rel: "noopener noreferrer", textContent: player.username }) : player.username,
        ),
        identity ? el("p", { className: "muted", textContent: identity }) : null,
      ),
    ),
    renderRatings(ratings),
  ];
}

function renderSummary(overview) {
  const { record, gameCount, scorePct, accuracy, takeaways } = overview;
  const parts = [
    record.win ? countOf(record.win, "win") : null,
    record.draw ? countOf(record.draw, "draw") : null,
    record.loss ? countOf(record.loss, "loss", "losses") : null,
  ].filter(Boolean);
  const detail = [`${scorePct}% score over the last ${gameCount === 1 ? "game" : `${gameCount} games`}`, accuracy ? `${accuracy.player.toFixed(1)}% average accuracy` : null].filter(Boolean);

  return el(
    "section",
    { className: "summary", "aria-labelledby": "score-heading" },
    el("h2", { id: "score-heading", className: "score-line", textContent: parts.join(", ") }),
    el("p", { className: "score-detail", textContent: detail.join(", ") }),
    takeaways.length
      ? el(
          "details",
          {},
          el("summary", { textContent: "More about these games" }),
          el("ul", { className: "notes" }, takeaways.map((text) => el("li", { textContent: text }))),
        )
      : null,
  );
}

function reviewedSide(game) {
  const analyses = analysesByGame.get(game.url);
  if (!analyses?.length || game.rules !== "chess") return null;
  const review = buildReview(parseGame(game.pgn, game.startFen), analyses);
  return review.isComplete ? review[game.color] : null;
}

function renderGameRow(game, index) {
  const reviewed = reviewedSide(game);
  const accuracy = game.accuracy ?? reviewed?.accuracy ?? null;
  const canReview = game.rules === "chess";
  const detail = reviewed
    ? `${countOf(reviewed.counts.blunder, "blunder")}, ${countOf(reviewed.counts.mistake, "mistake")}, ${reviewed.counts.great} great`
    : [capitalize(game.timeClass), `as ${game.color}`, game.opening ?? (canReview ? null : game.rules)].filter(Boolean).join(", ");

  const content = [
    el("span", { className: `outcome ${game.outcome}`, textContent: RESULT_WORDS[game.outcome] }),
    el(
      "span",
      { className: "game-main" },
      el("div", { className: "game-title" }, game.opponent.username, el("span", { textContent: game.opponent.rating })),
      el("div", { className: "game-detail", textContent: canReview ? detail : `${detail}. Review covers standard chess only.` }),
    ),
    el(
      "span",
      { className: "game-score" },
      accuracy === null ? el("span", { className: "muted", textContent: formatDate(game.endTime) }) : `${accuracy.toFixed(1)}%`,
      accuracy === null ? null : el("small", { textContent: "accuracy" }),
    ),
    canReview ? icon("M9 6l6 6-6 6") : el("span"),
  ];

  return el(
    "li",
    {},
    canReview
      ? el("button", { type: "button", className: "game", "aria-label": `Review game against ${game.opponent.username}, ${RESULT_WORDS[game.outcome].toLowerCase()}`, onclick: () => showReview(index) }, content)
      : el("div", { className: "game" }, content),
  );
}

function renderGames(games) {
  return el(
    "section",
    { className: "games-section", "aria-labelledby": "games-heading" },
    el("h2", { id: "games-heading", textContent: "Select a game to review" }),
    el("ol", { className: "games" }, games.map(renderGameRow)),
  );
}

function renderHome() {
  const { player, ratings, games, overview } = current;
  profileEl.replaceChildren(...renderProfile(player, ratings).filter(Boolean));
  resultsEl.replaceChildren(renderSummary(overview), renderGames(games));
}

function urlFor(gameIndex = null) {
  const params = new URLSearchParams();
  if (current) params.set("player", current.player.username);
  if (gameIndex !== null) params.set("game", gameIndex + 1);
  return `?${params}`;
}

function hideReview() {
  closeReview?.();
  closeReview = null;
  reviewEl.replaceChildren();
  reviewEl.hidden = true;
  homeEl.hidden = false;
}

function backToGames() {
  hideReview();
  renderHome();
}

function showReview(index, addToHistory = true) {
  const summary = current.games[index];
  if (!summary || summary.rules !== "chess") return;
  closeReview?.();
  homeEl.hidden = true;
  reviewEl.hidden = false;
  if (addToHistory) history.pushState(null, "", urlFor(index));
  window.scrollTo(0, 0);

  if (!analysesByGame.has(summary.url)) analysesByGame.set(summary.url, []);
  try {
    closeReview = openReview({
      container: reviewEl,
      summary,
      analyses: analysesByGame.get(summary.url),
      getEngine,
      onBack: () => {
        backToGames();
        history.pushState(null, "", urlFor());
      },
    });
  } catch (error) {
    console.error(error);
    backToGames();
    history.replaceState(null, "", urlFor());
    setStatus("This game's moves couldn't be read, so it can't be reviewed. Select another game.", true);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function search(rawInput, gameIndex = null) {
  const username = parseUsername(rawInput);
  if (!username) {
    setStatus("Enter a Chess.com username.", true);
    return;
  }

  const searchId = ++latestSearch;
  submitButton.disabled = true;
  hideReview();
  samplesEl.hidden = true;
  current = null;
  profileEl.replaceChildren();
  resultsEl.replaceChildren();
  setStatus(`Looking up ${username}`);

  try {
    const [player, stats] = await Promise.all([
      fetchPlayer(username),
      // Ratings are a bonus: a failure here shouldn't block the game review.
      fetchStats(username).catch(() => null),
    ]);
    if (searchId !== latestSearch) return;
    const ratings = summarizeRatings(stats);
    document.body.classList.add("has-player");
    input.value = player.username;
    profileEl.replaceChildren(...renderProfile(player, ratings).filter(Boolean));
    setStatus("Loading recent games");

    const rawGames = await fetchRecentGames(player.username, GAME_COUNT);
    if (searchId !== latestSearch) return;

    if (rawGames.length === 0) {
      history.replaceState(null, "", `?player=${encodeURIComponent(player.username)}`);
      setStatus(`Chess.com has no published games for ${player.username}. Try another player.`);
      return;
    }
    const games = rawGames.map((game) => ({ ...summarizeGame(game, player.username), username: player.username }));
    current = { player, ratings, games, overview: buildOverview(games) };
    renderHome();
    history.replaceState(null, "", urlFor());
    setStatus(games.length < GAME_COUNT ? `Chess.com has only ${games.length} of ${GAME_COUNT} games for this player.` : "");
    if (gameIndex !== null) showReview(gameIndex);
  } catch (error) {
    if (searchId !== latestSearch) return;
    setStatus(error.name === "ChessComError" ? error.message : "The game data couldn't be read. Try searching again.", true);
    if (error.name !== "ChessComError") console.error(error);
  } finally {
    if (searchId === latestSearch) submitButton.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  input.blur();
  search(input.value);
});

// Keeps the browser's Back and Forward buttons moving between the list and a review.
window.addEventListener("popstate", () => {
  if (!current) return;
  const gameNumber = Number(new URLSearchParams(location.search).get("game"));
  if (gameNumber > 0) showReview(gameNumber - 1, false);
  else backToGames();
});

samplesEl.append(
  el("span", { textContent: "Try" }),
  ...SAMPLE_PLAYERS.map((name) =>
    el("button", {
      type: "button",
      className: "sample",
      textContent: name,
      onclick: () => {
        input.value = name;
        search(name);
      },
    }),
  ),
);

const params = new URLSearchParams(location.search);
const initialPlayer = params.get("player");
if (initialPlayer) {
  const gameNumber = Number(params.get("game"));
  input.value = initialPlayer;
  search(initialPlayer, Number.isInteger(gameNumber) && gameNumber > 0 ? gameNumber - 1 : null);
} else {
  input.focus();
}
