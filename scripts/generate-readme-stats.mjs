import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceDir = resolve(process.env.STATS_SOURCE_DIR ?? ".github-readme-stats");
const username = process.env.GITHUB_REPOSITORY_OWNER ?? "hiro-sd";
const token = process.env.GITHUB_TOKEN ?? process.env.PAT_1;

if (!token) {
  throw new Error("GITHUB_TOKEN must contain a GitHub token");
}

const load = async (path) => import(pathToFileURL(resolve(sourceDir, path)).href);
const [{ renderStatsCard }, { renderTopLanguages }, { calculateRank }, languageColors] =
  await Promise.all([
    load("src/cards/stats.js"),
    load("src/cards/top-languages.js"),
    load("src/calculateRank.js"),
    readFile(resolve(sourceDir, "src/common/languageColors.json"), "utf8").then(
      JSON.parse,
    ),
  ]);

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "hiro-sd-profile-cards",
};

async function githubJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${data.message ?? url}`);
  }
  if (data.errors?.length) {
    throw new Error(`GitHub GraphQL: ${data.errors.map((e) => e.message).join("; ")}`);
  }
  return data;
}

async function fetchProfileStats() {
  const { data } = await githubJson("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: `query($login: String!) {
        user(login: $login) {
          name
          login
          commits: contributionsCollection { totalCommitContributions }
          reviews: contributionsCollection { totalPullRequestReviewContributions }
          repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }
          pullRequests(first: 1) { totalCount }
          openIssues: issues(states: OPEN) { totalCount }
          closedIssues: issues(states: CLOSED) { totalCount }
          followers { totalCount }
        }
      }`,
      variables: { login: username },
    }),
  });

  if (!data.user) {
    throw new Error(`GitHub user ${username} was not found`);
  }

  const user = data.user;
  return {
    name: user.name || user.login,
    totalPRs: user.pullRequests.totalCount,
    totalPRsMerged: 0,
    mergedPRsPercentage: 0,
    totalReviews: user.reviews.totalPullRequestReviewContributions,
    totalCommits: user.commits.totalCommitContributions,
    totalIssues: user.openIssues.totalCount + user.closedIssues.totalCount,
    totalStars: 0,
    totalDiscussionsStarted: 0,
    totalDiscussionsAnswered: 0,
    contributedTo: user.repositoriesContributedTo.totalCount,
    followers: user.followers.totalCount,
    rank: { level: "C", percentile: 100 },
  };
}

async function fetchOwnedRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await githubJson(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchLanguages(repos) {
  const totals = new Map();
  for (const repo of repos.filter((item) => !item.fork).slice(0, 100)) {
    const languages = await githubJson(repo.languages_url);
    for (const [name, bytes] of Object.entries(languages)) {
      const current = totals.get(name) ?? { bytes: 0, count: 0 };
      current.bytes += bytes;
      current.count += 1;
      totals.set(name, current);
    }
  }
  return Object.fromEntries(
    [...totals]
      .map(([name, { bytes, count }]) => [
        name,
        {
          name,
          color: languageColors[name] ?? "#858585",
          size: Math.sqrt(bytes * count),
          count,
        },
      ])
      .sort((a, b) => b[1].size - a[1].size),
  );
}

const [stats, repos] = await Promise.all([fetchProfileStats(), fetchOwnedRepos()]);
stats.totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
stats.rank = calculateRank({
  all_commits: false,
  commits: stats.totalCommits,
  prs: stats.totalPRs,
  reviews: stats.totalReviews,
  issues: stats.totalIssues,
  repos: repos.length,
  stars: stats.totalStars,
  followers: stats.followers,
});
delete stats.followers;
const languages = await fetchLanguages(repos);

await mkdir("assets", { recursive: true });

for (const [suffix, theme] of [
  ["light", "default"],
  ["dark", "github_dark_dimmed"],
]) {
  const cards = [
    [
      `assets/github-stats-${suffix}.svg`,
      renderStatsCard(stats, {
        show_icons: true,
        hide_rank: true,
        card_width: 400,
        theme,
        disable_animations: true,
      }),
    ],
    [
      `assets/top-languages-${suffix}.svg`,
      renderTopLanguages(languages, {
        layout: "compact",
        langs_count: 8,
        card_width: 340,
        theme,
        disable_animations: true,
      }),
    ],
  ];

  for (const [path, svg] of cards) {
    if (!/^\s*<svg\b/.test(svg)) {
      throw new Error(`GitHub Readme Stats returned invalid SVG for ${path}`);
    }
    await writeFile(path, svg);
    console.log(`Generated ${path}`);
  }
}
