const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PALETTE = {
  bg: '#09090e', surface: '#121218', fg: '#f5f3ff', muted: '#a5a2b5', border: '#2b2936',
  accent: '#bba4ff', c1: '#a78bfa', c2: '#67d7e8', c3: '#818cf8', c4: '#e5a0cf', c5: '#8dcab0', c6: '#d6ba7c',
  track: '#24222f', heat0: '#24222e', heat1: '#453461', heat2: '#71529b', heat3: '#aa83dc', heat4: '#d2b5ff',
  glow: '#25203c', pill: '#211c31',
};

const CLIENT_NAMES = {
  'claude-code': 'Claude Code', claude: 'Claude Code', claude_code: 'Claude Code',
  codex: 'Codex', 'codex-cli': 'Codex', opencode: 'OpenCode', cursor: 'Cursor',
  gemini: 'Gemini CLI', 'gemini-cli': 'Gemini CLI', amp: 'Amp',
  omp: 'OMP',
  pi: 'Pi', 'pi-agent': 'Pi', openclaw: 'OpenClaw', droid: 'Droid',
  copilot: 'GitHub Copilot', 'github-copilot': 'GitHub Copilot',
};

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function compactNumber(value) {
  const number = count(value);
  for (const [threshold, suffix] of [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (number >= threshold) return `${(number / threshold).toFixed(1)}${suffix}`;
  }
  return number.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fullNumber(value) {
  return count(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function ellipsis(value, limit) {
  const characters = Array.from(String(value));
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('');
}

function text(x, y, value, { size = 14, fill = 'fg', weight = 400, anchor = 'start', spacing, maxWidth } = {}) {
  const estimatedWidth = Array.from(String(value)).reduce((sum, character) => sum + (character.codePointAt(0) > 255 ? 1 : /[MW@#%]/.test(character) ? 0.9 : 0.62), 0) * size;
  const fitting = maxWidth && estimatedWidth > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" fill="var(--${fill})" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}${fitting}>${escapeXml(value)}</text>`;
}

function label(x, y, value, options = {}) {
  return text(x, y, value, { size: 10.5, fill: 'muted', weight: 600, spacing: '1.5', ...options });
}

function line(x1, y, x2) {
  return `<path d="M${x1} ${y}H${x2}" stroke="var(--border)"/>`;
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? escapeXml(url.href) : null;
  } catch {
    return null;
  }
}

function linked(url, markup, description) {
  const href = safeLink(url);
  return href ? `<a href="${href}" aria-label="${escapeXml(description)}">${markup}</a>` : markup;
}

function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.toISOString().slice(0, 10)} UTC`;
}

function dateKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function calendar(profile, months) {
  const collected = new Date(profile.collectedAt);
  const reference = Number.isFinite(collected.getTime()) ? collected : new Date();
  const end = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const monthStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  const start = Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(reference.getUTCDate(), lastDay)) + DAY;
  const mondayOffset = (new Date(start).getUTCDay() + 6) % 7;
  const gridStart = start - mondayOffset * DAY;
  const columns = Math.ceil(((end - gridStart) / DAY + 1) / 7);
  const days = new Map();
  for (const record of profile.contributions ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue;
    const day = Date.parse(`${record.date}T00:00:00Z`);
    if (!Number.isFinite(day) || dateKey(day) !== record.date || day < start || day > end) continue;
    days.set(day, (days.get(day) ?? 0) + count(record.tokens));
  }
  return { start, end, gridStart, columns, days, active: [...days.values()].filter((tokens) => tokens > 0).length };
}

function heatmap(data, width) {
  const x = 52;
  const y = 184;
  const step = (width - 80) / data.columns;
  const cell = Math.min(step - 2, 7);
  const rowStep = 10;
  const peak = Math.max(0, ...data.days.values());
  let markup = text(27, y + 7, 'M', { size: 9, fill: 'muted' });
  markup += text(27, y + rowStep * 4 + 7, 'F', { size: 9, fill: 'muted' });
  let previousMonthX = -100;
  let previousMonth = -1;
  for (let column = 0; column < data.columns; column += 1) {
    const columnStart = data.gridStart + column * 7 * DAY;
    const firstShown = Math.max(columnStart, data.start);
    const lastShown = Math.min(columnStart + 6 * DAY, data.end);
    const monthDate = new Date(firstShown);
    const nextMonth = new Date(lastShown).getUTCMonth();
    const month = nextMonth !== monthDate.getUTCMonth() ? nextMonth : monthDate.getUTCMonth();
    if (month !== previousMonth && column * step - previousMonthX >= 28 && column * step < width - 102) {
      markup += text(x + column * step, y - 12, MONTHS[month], { size: 9, fill: 'muted' });
      previousMonthX = column * step;
      previousMonth = month;
    }
    for (let row = 0; row < 7; row += 1) {
      const day = columnStart + row * DAY;
      if (day < data.start || day > data.end) continue;
      const tokens = data.days.get(day) ?? 0;
      const level = tokens > 0 ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tokens / peak) * 4))) : 0;
      markup += `<rect x="${(x + column * step).toFixed(2)}" y="${y + row * rowStep}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="1.6" fill="var(--heat${level})"><title>${dateKey(day)}: ${fullNumber(tokens)} AI tokens</title></rect>`;
    }
  }
  const summaryY = 285;
  markup += text(28, summaryY, `${data.active} active ${data.active === 1 ? 'day' : 'days'}`, { size: 14, weight: 600 });
  markup += text(width - 28, summaryY, `${dateKey(data.start)} — ${dateKey(data.end)}`, { size: 11, fill: 'muted', anchor: 'end' });
  const legendY = 322;
  markup += text(28, legendY, 'Public Tokscale submissions', { size: 10.5, fill: 'muted' });
  markup += text(width - 119, legendY, 'Less', { size: 9, fill: 'muted' });
  for (let level = 0; level < 5; level += 1) {
    markup += `<rect x="${width - 93 + level * 10}" y="${legendY - 7}" width="7" height="7" rx="1.5" fill="var(--heat${level})"/>`;
  }
  markup += text(width - 27, legendY, 'More', { size: 9, fill: 'muted', anchor: 'end' });
  return markup;
}

function identityCard(profile, width, activity) {
  const displayName = profile.displayName || profile.username;
  const username = `@${profile.username}`;
  let markup = `<path d="M28 27H53" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>`;
  markup += text(28, 88, ellipsis(displayName, 20), { size: 50, weight: 700, spacing: '-2', maxWidth: width - 56 });
  markup += linked(profile.profileUrl, text(29, 118, ellipsis(username, 48), { size: 15, fill: 'muted', maxWidth: width - 58 }), `Open ${username} on Tokscale`);
  markup += line(28, 139, width - 28);
  markup += label(28, 161, 'TOKSCALE AI ACTIVITY', { size: 9.5, spacing: '1' });
  markup += label(width - 28, 161, 'LAST 12 MONTHS', { anchor: 'end', size: 9.5 });
  return markup + heatmap(activity, width);
}

function totalsCard(profile, width) {
  const total = compactNumber(profile.totalTokens);
  const rank = Number.isInteger(profile.rank) && profile.rank > 0 ? `#${fullNumber(profile.rank)}` : 'Unranked';
  let markup = `<ellipse cx="${width - 130}" cy="94" rx="100" ry="88" fill="url(#token-glow)"/>`;
  markup += label(28, 35, 'AI TOKENS / ALL TIME', { fill: 'accent' });
  const totalSize = Math.min(78, (width - 56) / (total.length * 0.62));
  markup += `<text x="25" y="127" font-size="${totalSize}" font-weight="750" letter-spacing="-4" fill="url(#token-accent)">${escapeXml(total)}</text>`;
  markup += text(28, 155, 'Input, output & cached tokens', { size: 12.5, fill: 'muted' });
  markup += text(28, 178, `Est. model cost · $${compactNumber(profile.totalCost)}`, { size: 11, fill: 'muted' });
  markup += line(28, 200, width - 28);
  markup += label(28, 231, 'TOKSCALE RANK', { size: 10 });
  markup += label(28, 252, 'ALL-TIME TOKENS', { size: 9, spacing: '1' });
  markup += text(width - 28, 258, rank, { size: rank.length > 8 ? 31 : 45, weight: 700, fill: 'accent', anchor: 'end', spacing: '-1.5', maxWidth: width - 200 });
  const submissions = count(profile.submissionCount);
  markup += text(28, 285, `${fullNumber(submissions)} public ${submissions === 1 ? 'submission' : 'submissions'}`, { size: 11.5, fill: 'muted' });
  markup += text(28, 322, 'All-time leaderboard · link below', { size: 11, fill: 'accent', weight: 500 });
  return markup;
}

function modelsCard(profile, width) {
  const models = (profile.models ?? []).filter((model) => count(model.tokens) > 0).map((model) => ({ name: String(model.name), tokens: count(model.tokens) })).sort((a, b) => b.tokens - a.tokens);
  const total = models.reduce((sum, model) => sum + model.tokens, 0);
  const rows = models.length > 5
    ? [...models.slice(0, 4), { name: `Other models (${models.length - 4})`, tokens: models.slice(4).reduce((sum, model) => sum + model.tokens, 0) }]
    : models;
  let markup = text(28, 35, 'Models · last 12 months', { size: 20, weight: 600, spacing: '-0.5' });
  markup += label(28, 57, 'TOKEN SHARE · REPORTED MODEL USAGE', { size: 9, spacing: '1' });
  if (rows.length === 0) {
    return markup + text(28, 111, 'No model usage submitted.', { size: 14, fill: 'muted' });
  }
  for (const [index, model] of rows.entries()) {
    const y = 88 + index * 39;
    const share = total > 0 ? model.tokens / total : 0;
    const metric = `${compactNumber(model.tokens)} · ${(share * 100).toFixed(1)}%`;
    markup += `<g><title>${escapeXml(model.name)}: ${fullNumber(model.tokens)} tokens, ${(share * 100).toFixed(1)}% of reported model tokens in the last 12 months</title>`;
    markup += `<circle cx="32" cy="${y - 4}" r="3" fill="var(--c${index + 1})"/>`;
    markup += text(44, y, ellipsis(model.name, width < 500 ? 24 : 35), { size: 12.5, weight: 500, maxWidth: width - 202 });
    markup += text(width - 28, y, metric, { size: 11.5, fill: 'muted', anchor: 'end' });
    markup += `<rect x="28" y="${y + 9}" width="${width - 56}" height="5" rx="2.5" fill="var(--track)"/>`;
    if (share > 0) markup += `<rect x="28" y="${y + 9}" width="${((width - 56) * share).toFixed(2)}" height="5" rx="2.5" fill="var(--c${index + 1})"/>`;
    markup += '</g>';
  }
  return markup;
}

function breakdownCard(profile, width) {
  const categories = [
    ['Input', count(profile.tokens?.input)], ['Output', count(profile.tokens?.output)],
    ['Cache read', count(profile.tokens?.cacheRead)], ['Cache write', count(profile.tokens?.cacheWrite)],
    ['Reasoning', count(profile.tokens?.reasoning)],
  ];
  const total = categories.reduce((sum, [, tokens]) => sum + tokens, 0);
  let markup = text(28, 35, 'Token anatomy', { size: 20, weight: 600, spacing: '-0.5' });
  markup += text(28, 57, 'All-time · cached tokens included', { size: 11.5, fill: 'muted' });
  markup += `<rect x="28" y="74" width="${width - 56}" height="7" rx="3.5" fill="var(--track)"/>`;
  let offset = 28;
  for (const [index, [, tokens]] of categories.entries()) {
    if (tokens === 0 || total === 0) continue;
    const segmentWidth = (width - 56) * tokens / total;
    markup += `<rect x="${offset.toFixed(2)}" y="74" width="${segmentWidth.toFixed(2)}" height="7" fill="var(--c${index + 1})"/>`;
    offset += segmentWidth;
  }
  for (const [index, [name, tokens]] of categories.entries()) {
    const y = 108 + index * 25;
    markup += `<circle cx="31" cy="${y - 4}" r="3" fill="var(--c${index + 1})"/>`;
    markup += text(43, y, name, { size: 12, fill: 'muted' });
    markup += `<g><title>${escapeXml(name)}: ${fullNumber(tokens)} tokens</title>${text(width - 28, y, compactNumber(tokens), { size: 13, weight: 600, anchor: 'end' })}</g>`;
  }
  markup += line(28, 226, width - 28);
  const clients = (profile.clients ?? []).map((client) => CLIENT_NAMES[String(client).toLowerCase()] ?? String(client));
  const clientLabel = clients.length ? `Clients · ${[...new Set(clients)].join(' / ')}` : 'No client details submitted';
  markup += `<g><title>${escapeXml(clientLabel)}</title>${text(28, 252, ellipsis(clientLabel, width < 420 ? 47 : 56), { size: 10.5, fill: 'muted', maxWidth: width - 56 })}</g>`;
  return markup;
}

/** Render a dependency-free, standalone dashboard from public Tokscale profile data. */
export function renderDashboard(profile) {
  const palette = PALETTE;
  const width = 1000;
  const height = 728;
  const activity = calendar(profile, 12);
  const sourceDate = timestamp(profile.updatedAt);
  const collectedDate = timestamp(profile.collectedAt);
  const source = sourceDate ? `Source updated ${sourceDate}` : 'Source update time unavailable';
  const collected = collectedDate ? `Collected ${collectedDate}` : 'Collection time unavailable';
  const rank = Number.isInteger(profile.rank) && profile.rank > 0 ? `rank ${fullNumber(profile.rank)}` : 'unranked';
  const description = `${profile.displayName || profile.username} (@${profile.username}): ${fullNumber(profile.totalTokens)} all-time AI tokens; Tokscale all-time token ranking ${rank}. ${activity.active} active days from ${dateKey(activity.start)} through ${dateKey(activity.end)}, based only on public Tokscale submissions, not GitHub activity. Token totals include cached tokens. Model costs are estimates, not paid spend. ${source}. ${collected}.`;
  function card(x, y, w, h, content) {
    return `<g transform="translate(${x} ${y})"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="20" fill="var(--surface)" stroke="var(--border)"/>${content}</g>`;
  }
  const cards = [
    card(20, 20, 548, 344, identityCard(profile, 548, activity)),
    card(584, 20, 396, 344, totalsCard(profile, 396)),
    card(20, 380, 548, 280, modelsCard(profile, 548)),
    card(584, 380, 396, 280, breakdownCard(profile, 396)),
  ];
  const footer = text(28, 686, 'Public Tokscale data · cached tokens included · model-price estimates, not paid spend.', { size: 11, fill: 'muted' })
    + text(28, 707, `${source} · ${collected}`, { size: 10.5, fill: 'muted' });
  const variables = Object.entries(palette).map(([name, color]) => `--${name}:${color}`).join(';');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dashboard-title dashboard-desc" lang="en">
<title id="dashboard-title">${escapeXml(profile.displayName || profile.username)} · public AI activity dashboard</title>
<desc id="dashboard-desc">${escapeXml(description)}</desc>
<defs>
  <style>:root{${variables};color-scheme:dark}text{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}a{text-decoration:none}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}</style>
  <linearGradient id="token-accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.accent}"/><stop offset="1" stop-color="${palette.c2}"/></linearGradient>
  <radialGradient id="token-glow"><stop offset="0" stop-color="${palette.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${palette.surface}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${width}" height="${height}" rx="24" fill="var(--bg)"/>
${cards.join('\n')}
${footer}
</svg>\n`;
}
