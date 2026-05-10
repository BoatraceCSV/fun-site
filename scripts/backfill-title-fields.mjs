// 既存の RacePrediction JSON に dayLabel / grade を後追いで足すワンショット移行スクリプト。
// BoatraceCSV (https://boatracecsv.github.io) の title CSV を取得してマージする。
//
// 実行: node backfill-title-fields.mjs <races-root>
// 例:   node backfill-title-fields.mjs /path/to/packages/web/src/data/races
//
// 旧 backfill-day-label.mjs の上位互換。grade も併せて反映する。

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const HTTP_BASE = "https://boatracecsv.github.io/data/programs/title";

/** 単純な CSV パーサ。ダブルクオートには未対応 (このフィードでは未使用)。 */
const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
};

const fetchTitleCsv = async (date) => {
  const url = `${HTTP_BASE}/${date.replaceAll("-", "/")}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
};

const buildTitleMap = async (date) => {
  const csv = await fetchTitleCsv(date);
  const rows = parseCsv(csv);
  const map = new Map();
  for (const row of rows) {
    const code = row["レースコード"];
    if (!code) continue;
    map.set(code, {
      dayLabel: row["日次"] ?? "",
      grade: row["グレード"] ?? "",
    });
  }
  return map;
};

const main = async () => {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node backfill-title-fields.mjs <races-root>");
    process.exit(1);
  }

  const dates = (await readdir(root)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  for (const date of dates) {
    let titleMap;
    try {
      titleMap = await buildTitleMap(date);
      console.log(`[${date}] fetched ${titleMap.size} title rows`);
    } catch (e) {
      console.warn(`[${date}] skip (${e.message})`);
      continue;
    }

    const dir = resolve(root, date);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    let patched = 0;
    let alreadyOk = 0;
    let missing = 0;
    for (const f of files) {
      const fp = resolve(dir, f);
      const json = JSON.parse(await readFile(fp, "utf-8"));
      // 旧スキーマ (raceCode が無いなど) はスキップ
      if (typeof json.raceCode !== "string") continue;

      const meta = titleMap.get(json.raceCode);
      const oldDayLabel = typeof json.dayLabel === "string" ? json.dayLabel : "";
      const oldGrade = typeof json.grade === "string" ? json.grade : "";

      const newDayLabel = meta?.dayLabel ?? "";
      const newGrade = meta?.grade ?? "";

      const needsPatch = json.dayLabel !== newDayLabel || json.grade !== newGrade;

      if (!needsPatch && oldDayLabel.length > 0 && oldGrade.length > 0) {
        alreadyOk++;
        continue;
      }
      if (meta === undefined) missing++;

      json.dayLabel = newDayLabel;
      json.grade = newGrade;

      // 既存の改行/空白スタイルに合わせて 2 スペースインデントで保存
      await writeFile(fp, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
      patched++;
    }
    console.log(
      `[${date}] patched=${patched}, already=${alreadyOk}, missing-from-upstream=${missing}`,
    );
  }
};

await main();
