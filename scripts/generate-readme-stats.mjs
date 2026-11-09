import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceDir = resolve(process.env.STATS_SOURCE_DIR ?? ".github-readme-stats");
const username = process.env.GITHUB_REPOSITORY_OWNER ?? "hiro-sd";

if (!process.env.PAT_1) {
  throw new Error("PAT_1 must contain a GitHub token for GitHub Readme Stats");
}

const load = async (path) => import(pathToFileURL(resolve(sourceDir, path)).href);
const [{ fetchStats }, { fetchTopLanguages }, { renderStatsCard }, { renderTopLanguages }] =
  await Promise.all([
    load("src/fetchers/stats.js"),
    load("src/fetchers/top-languages.js"),
    load("src/cards/stats.js"),
    load("src/cards/top-languages.js"),
  ]);

const [stats, languages] = await Promise.all([
  fetchStats(username),
  fetchTopLanguages(username, [], 0.5, 0.5),
]);

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
