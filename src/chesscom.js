// Client for the Chess.com Published-Data API: https://www.chess.com/news/view/published-data-api
import { playerColor } from "./analysis.js";

const BASE_URL = "https://api.chess.com/pub";

export class ChessComError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ChessComError";
    this.status = status;
  }
}

// Accepts a plain username or a pasted profile link such as chess.com/member/Hikaru.
export function parseUsername(input) {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/chess\.com\/(?:member|players?)\/([^/?#\s]+)/i);
  return (fromLink ? fromLink[1] : trimmed).replace(/^@/, "").toLowerCase();
}

async function getJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new ChessComError("Couldn't reach Chess.com. Check your connection and try again.");
  }
  if (response.status === 429) {
    throw new ChessComError("Chess.com is rate limiting requests. Wait a moment and try again.", 429);
  }
  if (!response.ok) {
    throw new ChessComError(`Chess.com returned an error (${response.status}).`, response.status);
  }
  return response.json();
}

export async function fetchPlayer(username, fetchImpl = fetch) {
  try {
    return await getJson(`${BASE_URL}/player/${encodeURIComponent(username)}`, fetchImpl);
  } catch (error) {
    if (error.status === 404) {
      throw new ChessComError(
        `No Chess.com player is named "${username}". Usernames must match exactly, but capitals don't matter.`,
        404,
      );
    }
    throw error;
  }
}

export function fetchStats(username, fetchImpl = fetch) {
  return getJson(`${BASE_URL}/player/${encodeURIComponent(username)}/stats`, fetchImpl);
}

// Returns the player's most recent games, newest first. Archives are monthly and only
// exist for months with games, so this walks back one month at a time until it has enough.
export async function fetchRecentGames(username, limit = 5, fetchImpl = fetch) {
  const playerUrl = `${BASE_URL}/player/${encodeURIComponent(username)}`;
  const { archives } = await getJson(`${playerUrl}/games/archives`, fetchImpl);
  const games = [];
  for (const archiveUrl of [...archives].reverse()) {
    const archive = await getJson(archiveUrl, fetchImpl);
    games.push(...archive.games.filter((game) => playerColor(game, username)));
    if (games.length >= limit) break;
  }
  return games.sort((a, b) => b.end_time - a.end_time).slice(0, limit);
}
