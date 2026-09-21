import type { RacePrediction } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import {
  buildPredictionObjectName,
  planPredictionUploads,
  predictionContentHash,
} from "../site-builder/data-writer.js";

// 差分判定に関係するのは raceCode と generatedAt だけなので、残りは最小限の
// ダミーで埋める (型は RacePrediction にキャスト)。
const prediction = (raceCode: string, generatedAt: string, raceName = "一般"): RacePrediction =>
  ({
    raceCode,
    raceDate: `${raceCode.slice(0, 4)}-${raceCode.slice(4, 6)}-${raceCode.slice(6, 8)}`,
    stadiumId: raceCode.slice(8, 10),
    raceNumber: Number(raceCode.slice(10, 12)),
    raceName,
    generatedAt,
  }) as unknown as RacePrediction;

describe("predictionContentHash", () => {
  it("generatedAt が違っても内容が同じなら同じハッシュになる", () => {
    const a = prediction("202609200101", "2026-09-20T01:00:00.000Z");
    const b = prediction("202609200101", "2026-09-20T01:02:00.000Z");
    expect(predictionContentHash(a)).toBe(predictionContentHash(b));
  });

  it("内容が変われば違うハッシュになる", () => {
    const a = prediction("202609200101", "2026-09-20T01:00:00.000Z", "一般");
    const b = prediction("202609200101", "2026-09-20T01:00:00.000Z", "特選");
    expect(predictionContentHash(a)).not.toBe(predictionContentHash(b));
  });
});

describe("planPredictionUploads", () => {
  const r1 = prediction("202609200101", "2026-09-20T01:00:00.000Z");
  const r2 = prediction("202609200102", "2026-09-20T01:00:00.000Z");
  const r3 = prediction("202609200103", "2026-09-20T01:00:00.000Z");

  it("リモートのハッシュが一致するレースはスキップし、変化・未登録のレースだけ残す", () => {
    const remote = new Map<string, string | undefined>([
      [buildPredictionObjectName("2026-09-20", r1.raceCode), predictionContentHash(r1)],
      [buildPredictionObjectName("2026-09-20", r2.raceCode), "stale-hash"],
      // r3 はリモートに無い
    ]);
    const plan = planPredictionUploads([r1, r2, r3], remote);
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpload.map((e) => e.objectName)).toEqual([
      "predictions/2026-09-20/202609200102.json",
      "predictions/2026-09-20/202609200103.json",
    ]);
    expect(plan.toUpload[0]?.contentHash).toBe(predictionContentHash(r2));
  });

  it("ハッシュ無しの旧オブジェクト (undefined) はアップロード対象になる", () => {
    const remote = new Map<string, string | undefined>([
      [buildPredictionObjectName("2026-09-20", r1.raceCode), undefined],
    ]);
    const plan = planPredictionUploads([r1], remote);
    expect(plan.unchanged).toBe(0);
    expect(plan.toUpload).toHaveLength(1);
  });

  it("リモート情報が空 (一覧失敗) なら全件アップロードする", () => {
    const plan = planPredictionUploads([r1, r2, r3], new Map());
    expect(plan.unchanged).toBe(0);
    expect(plan.toUpload).toHaveLength(3);
  });
});
