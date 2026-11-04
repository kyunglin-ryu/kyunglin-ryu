const USERNAME = 'kyunglin-ryu';
const TOKSCALE_ORIGIN = 'https://tokscale.ai';
const REQUEST_TIMEOUT_MS = 20_000;

function invalid(field, expected) {
  throw new Error(`Tokscale public profile contract changed: ${field} must be ${expected}. Check the public API before updating dashboard assets.`);
}

function object(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, 'an object');
  }
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, 'a nonempty string');
  }
  return value;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid(field, 'a nonnegative safe integer');
  }
  return value;
}

function amount(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(field, 'a nonnegative finite number');
  }
  return value;
}

function array(value, field) {
  if (!Array.isArray(value)) invalid(field, 'an array');
  return value;
}

function rank(value, field) {
  if (value === null) return null;
  if (count(value, field) === 0) invalid(field, 'a positive integer or null');
  return value;
}

function calendarDate(value, field) {
  text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field, 'a YYYY-MM-DD date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid(field, 'a valid calendar date');
  }
  return value;
}

function updatedTimestamp(value) {
  if (value === null) return null;
  text(value, 'updatedAt');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    invalid('updatedAt', 'an ISO8601 timestamp or null');
  }
  return new Date(value).toISOString();
}

async function fetchPublicJson(url) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    const reason = signal.aborted
      ? `timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`
      : 'failed to connect';
    throw new Error(`Tokscale public API ${reason}: ${url}. Retry later; keep existing dashboard assets unchanged.`, { cause });
  }
  if (!response.ok) {
    throw new Error(`Tokscale public API returned HTTP ${response.status}: ${url}. Check public profile availability or rate limits; keep existing dashboard assets unchanged.`);
  }
  try {
    return await response.json();
  } catch (cause) {
    const reason = signal.aborted
      ? `timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds while reading JSON`
      : 'returned invalid JSON';
    throw new Error(`Tokscale public API ${reason}: ${url}. Retry or inspect the public API; keep existing dashboard assets unchanged.`, { cause });
  }
}

/** Read public, unauthenticated Tokscale statistics without touching local usage or assets. */
export async function collectProfile() {
  const profile = object(
    await fetchPublicJson(`${TOKSCALE_ORIGIN}/api/users/${USERNAME}?period=all`),
    'profile',
  );
  if (profile.period !== undefined && profile.period !== 'all') {
    invalid('period', 'all for an all-time dashboard');
  }
  const user = object(profile.user, 'user');
  const stats = object(profile.stats, 'stats');
  const username = text(user.username, 'user.username');
  if (username !== USERNAME) invalid('user.username', USERNAME);
  const displayName = user.displayName === null
    ? username
    : text(user.displayName, 'user.displayName');
  const totalTokens = count(stats.totalTokens, 'stats.totalTokens');
  const totalCost = amount(stats.totalCost, 'stats.totalCost');
  const submissionCount = count(stats.submissionCount, 'stats.submissionCount');
  const tokens = {
    input: count(stats.inputTokens, 'stats.inputTokens'),
    output: count(stats.outputTokens, 'stats.outputTokens'),
    cacheRead: count(stats.cacheReadTokens, 'stats.cacheReadTokens'),
    cacheWrite: count(stats.cacheWriteTokens, 'stats.cacheWriteTokens'),
    reasoning: stats.reasoningTokens === undefined
      ? 0
      : count(stats.reasoningTokens, 'stats.reasoningTokens'),
  };
  const clients = array(profile.clients, 'clients').map((client, index) => text(client, `clients[${index}]`));
  const modelNames = new Set();
  // The API's percentage is COST share, not token share. Preserve token counts instead.
  const models = array(profile.modelUsage, 'modelUsage').map((entry, index) => {
    const field = `modelUsage[${index}]`;
    const usage = object(entry, field);
    const name = text(usage.model, `${field}.model`);
    if (modelNames.has(name)) invalid(`${field}.model`, 'a unique model name');
    modelNames.add(name);
    return { name, tokens: count(usage.tokens, `${field}.tokens`) };
  }).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const dates = new Set();
  const contributions = array(profile.contributions, 'contributions').map((entry, index) => {
    const field = `contributions[${index}]`;
    const day = object(entry, field);
    const date = calendarDate(day.date, `${field}.date`);
    if (dates.has(date)) invalid(`${field}.date`, 'a unique calendar date');
    dates.add(date);
    const totals = object(day.totals, `${field}.totals`);
    return { date, tokens: count(totals.tokens, `${field}.totals.tokens`) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (totalTokens > 0 && models.length === 0) invalid('modelUsage', 'nonempty when totalTokens is positive');
  if (totalTokens > 0 && contributions.length === 0) invalid('contributions', 'nonempty when totalTokens is positive');
  const updatedAt = updatedTimestamp(profile.updatedAt);

  let allTimeRank;
  if (user.rank !== undefined && user.rankDateRange == null) {
    // This profile rank is already the all-time token rank; avoid a second request.
    allTimeRank = rank(user.rank, 'user.rank');
  } else {
    const ranking = object(await fetchPublicJson(
      `${TOKSCALE_ORIGIN}/api/leaderboard/user/${USERNAME}?period=all&sortBy=tokens`,
    ), 'leaderboard');
    // Reject mismatched snapshots rather than attach a rank to different totals.
    if (count(ranking.totalTokens, 'leaderboard.totalTokens') !== totalTokens) {
      throw new Error('Tokscale profile and all-time leaderboard totals differ. Retry after their public caches refresh; keep existing dashboard assets unchanged.');
    }
    allTimeRank = rank(ranking.rank, 'leaderboard.rank');
  }

  return {
    username,
    displayName,
    profileUrl: `${TOKSCALE_ORIGIN}/u/${username}`,
    leaderboardUrl: `${TOKSCALE_ORIGIN}/leaderboard?period=all&sortBy=tokens&search=${encodeURIComponent(username)}`,
    updatedAt,
    collectedAt: new Date().toISOString(),
    totalTokens,
    totalCost,
    rank: allTimeRank,
    submissionCount,
    clients,
    tokens,
    models,
    contributions,
  };
}
