import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collectProfile } from './collect-profile.mjs';
import { renderDashboard } from './render-dashboard.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await collectProfile();
const escapeAttribute = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rank = profile.rank === null ? 'unranked' : `rank #${new Intl.NumberFormat('en-US').format(profile.rank)}`;
// Collect and render everything before replacing any published file.
const dashboard = renderDashboard(profile);
const readme = `<a href="${escapeAttribute(profile.profileUrl)}">
  <img src="./assets/profile.svg" alt="${escapeAttribute(profile.displayName)} — AI coding activity, model mix, token usage, and Tokscale ${escapeAttribute(rank)} by all-time tokens" width="1000">
</a>

<p align="center">
  <a href="${escapeAttribute(profile.profileUrl)}">Tokscale profile ↗</a>
  &nbsp; · &nbsp;
  <a href="${escapeAttribute(profile.leaderboardUrl)}">All-time token ranking ↗</a>
  &nbsp; · &nbsp;
  <a href="https://github.com/${escapeAttribute(profile.username)}">GitHub ↗</a>
</p>

<details>
<summary>Data &amp; automatic updates</summary>

- Statistics come exclusively from my public [Tokscale profile](${profile.profileUrl}). The activity calendar represents **AI usage**, not GitHub contributions.
- Token totals include cached context. Costs, where shown, are model-price estimates rather than subscription charges.
- Rank is **all-time, sorted by tokens**, not monthly rank or cost rank.
- The profile uses one black dashboard, regardless of GitHub's theme.
- [GitHub Actions](https://github.com/${profile.username}/${profile.username}/actions/workflows/profile-dashboard.yml) refreshes the dashboard every six hours. Manual refresh is available with **Run workflow**. Scheduled runs and image caches can delay visibility.
- \`tokscale submit\` updates the source usage. This repository only reads public statistics: it does not read local conversations, submit usage logs, or access private GitHub activity.
- Regenerate locally with Node.js 22 or newer:

  \`node scripts/update-profile.mjs\`

</details>
`;
await mkdir(`${root}/assets`, { recursive: true });
await Promise.all([
  writeFile(`${root}/assets/profile.svg`, dashboard),
  writeFile(`${root}/README.md`, readme),
]);
console.log(JSON.stringify({
  username: profile.username,
  tokens: profile.totalTokens,
  rank: profile.rank,
  sourceUpdatedAt: profile.updatedAt,
  card: 'profile.svg',
  source: profile.profileUrl,
}));
