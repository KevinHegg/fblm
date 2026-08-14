import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const BASE_URL = "https://much-ado.net/legislators";
const DATE_URL = `${BASE_URL}/legislators-by-date/`;
const outputPath = "public/data/legislators.json";

const counts = JSON.parse(await fs.readFile("public/data/counts.json", "utf8"));
const countyToFips = new Map(
  counts.records.map((record) => [normalizeCounty(record.county), record.fips]),
);

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Against All Odds map data builder (educational project)" },
  });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return response.text();
}

function normalizeCounty(value) {
  return String(value ?? "")
    .replace(/\s+Count(?:y|ies)$/i, "")
    .replace(/\s*\(formerly Colfax\)$/i, "")
    .trim();
}

function absoluteUrl(href) {
  return new URL(href, DATE_URL).href;
}

function parseRoster(html) {
  const $ = cheerio.load(html);
  const roster = [];

  $("h2").each((_, heading) => {
    const yearText = $(heading).text().trim();
    if (!/^18\d{2}$/.test(yearText)) return;
    const year = Number(yearText);
    let chamber = "";
    let node = $(heading).next();

    while (node.length && node[0].tagName?.toLowerCase() !== "h2") {
      const text = node.text().replace(/\s+/g, " ").trim();
      if (/^House$/i.test(text)) chamber = "House";
      if (/^Senate$/i.test(text)) chamber = "Senate";

      node.find('a[href*="/legislators/legislators/"]').each((__, anchor) => {
        const name = $(anchor).text().replace(/\s+/g, " ").trim();
        const href = $(anchor).attr("href");
        if (name && href) roster.push({ year, chamber, name, url: absoluteUrl(href) });
      });

      if (node.is('a[href*="/legislators/legislators/"]')) {
        const name = node.text().replace(/\s+/g, " ").trim();
        const href = node.attr("href");
        if (name && href) roster.push({ year, chamber, name, url: absoluteUrl(href) });
      }

      node = node.next();
    }
  });

  return roster;
}

function parseProfile(html, fallbackName, url) {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim() || fallbackName;
  const profileHeading = $("h2")
    .filter((_, heading) => /\([^)]+\)/.test($(heading).text()))
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const parenthetical = profileHeading.match(/\(([^)]+)\)/)?.[1] ?? "";
  const headerCounties = parenthetical
    .split("/")
    .map(normalizeCounty)
    .filter(Boolean)
    .filter((county) => county.toLowerCase() !== "state");

  const officeLines = [];
  $("p").each((_, paragraph) => {
    const text = $(paragraph).text().replace(/\s+/g, " ").trim();
    const match = text.match(/^State (House|Senate):\s*(.+)$/i);
    if (match) officeLines.push({ chamber: match[1], text: match[2] });
  });

  return { name, url, headerCounties, officeLines };
}

function countiesForService(profile, year, chamber) {
  const matchingLine = profile.officeLines.find(
    (line) => line.chamber.toLowerCase() === chamber.toLowerCase(),
  );
  if (!matchingLine) return profile.headerCounties;

  const terms = [...matchingLine.text.matchAll(/(18\d{2})(?:\s*[-–]\s*(18\d{2}))?(?:\s*\(([^)]+)\))?/g)];
  const matchingTerm = terms.find((match) => {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    return year >= start && year <= end;
  });
  const countyText = matchingTerm?.[3];
  if (!countyText) return profile.headerCounties;
  return countyText.split("/").map(normalizeCounty).filter(Boolean);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

const roster = parseRoster(await fetchHtml(DATE_URL));
const uniquePeople = [...new Map(roster.map((person) => [person.url, person])).values()];
const profiles = await mapWithConcurrency(uniquePeople, 8, async (person) => {
  const html = await fetchHtml(person.url);
  return parseProfile(html, person.name, person.url);
});
const profileByUrl = new Map(profiles.map((profile) => [profile.url, profile]));

const groups = new Map();
for (const service of roster) {
  const profile = profileByUrl.get(service.url);
  const counties = countiesForService(profile, service.year, service.chamber);
  for (const county of counties) {
    const fips = countyToFips.get(normalizeCounty(county));
    if (!fips) continue;
    const key = `${service.year}|${fips}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name: profile.name, url: service.url, chamber: service.chamber });
  }
}

const records = counts.records
  .filter((record) => record.count > 0)
  .map((record) => {
    const people = groups.get(`${record.year}|${record.fips}`) ?? [];
    return { ...record, people };
  });

const mismatches = records
  .filter((record) => record.people.length !== record.count)
  .map((record) => ({
    year: record.year,
    county: record.county,
    expected: record.count,
    found: record.people.length,
    people: record.people.map((person) => person.name),
  }));

await fs.writeFile(
  outputPath,
  JSON.stringify(
    {
      meta: {
        source: DATE_URL,
        generatedAt: new Date().toISOString(),
        note: "Names and biography links are derived from the companion site's year rosters and profile service details.",
      },
      records,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      rosterEntries: roster.length,
      profiles: profiles.length,
      matchedCountyYears: records.filter((record) => record.people.length === record.count).length,
      totalCountyYears: records.length,
      mismatches,
    },
    null,
    2,
  ),
);
