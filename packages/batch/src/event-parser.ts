/**
 * Eventarc 経由で渡される Pub/Sub CloudEvent をパースする。
 *
 * Cloud Run Job が Eventarc Pub/Sub トリガーで起動された場合、
 * CloudEvent JSON は次のいずれかの方法で渡される（GCP の挙動が時期によって揺れるため両対応する）:
 *
 * 1. プロセスの第 1 引数 (`process.argv[2]`) として CloudEvent JSON 文字列が渡される
 * 2. 環境変数 `CE_DATA` または `PUBSUB_MESSAGE` に CloudEvent body の data 部が base64 で入る
 *
 * いずれも無い場合（手動 `gcloud run jobs execute` 等）はメッセージ無し扱いとし、
 * 全レース対象のフルリビルドにフォールバックする。
 */

/** 単一レース分の更新情報。preview-realtime の処理ループで生成される */
export type UpdatedRace = {
  readonly raceCode: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  /** 更新があった CSV 種別（"stt" | "index" | "title" | "race_cards" | "results"） */
  readonly csvTypes: readonly string[];
  /** index CSV の state（"daily" | "realtime"）。index 更新時のみ含まれる */
  readonly indexState?: "daily" | "realtime";
};

/** Pub/Sub topic `realtime-completed` のメッセージ payload */
export type RealtimeCompletedMessage = {
  readonly publishedAt: string;
  readonly raceDate: string;
  /** 起動契機 ("realtime" | "daily-bootstrap" | "manual") */
  readonly trigger?: string;
  readonly updatedRaces: readonly UpdatedRace[];
  readonly gcsPrefix?: string;
};

/** パース結果 */
export type ParsedEvent =
  | {
      readonly kind: "pubsub";
      readonly message: RealtimeCompletedMessage;
    }
  | {
      readonly kind: "none";
      readonly reason: string;
    };

/** CloudEvent / Pub/Sub envelope の構造（最小限） */
type PubSubEnvelope = {
  message?: {
    data?: string;
    attributes?: Record<string, string>;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
};

const decodeBase64 = (b64: string): string => {
  return Buffer.from(b64, "base64").toString("utf-8");
};

const parseRealtimeMessage = (json: string): RealtimeCompletedMessage => {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Pub/Sub message body: not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.raceDate !== "string") {
    throw new Error("Invalid Pub/Sub message: missing raceDate");
  }
  if (!Array.isArray(obj.updatedRaces)) {
    throw new Error("Invalid Pub/Sub message: updatedRaces is not an array");
  }
  return obj as unknown as RealtimeCompletedMessage;
};

const tryParseEnvelope = (raw: string): RealtimeCompletedMessage | undefined => {
  // 1. PubSub envelope ({"message": {"data": "<base64>"}})
  try {
    const envelope = JSON.parse(raw) as PubSubEnvelope | RealtimeCompletedMessage;
    if (
      envelope &&
      typeof envelope === "object" &&
      "message" in envelope &&
      envelope.message?.data
    ) {
      return parseRealtimeMessage(decodeBase64(envelope.message.data));
    }
    // 2. CloudEvent body that already contains the parsed message
    if (
      envelope &&
      typeof envelope === "object" &&
      "raceDate" in envelope &&
      "updatedRaces" in envelope
    ) {
      return envelope as RealtimeCompletedMessage;
    }
  } catch {
    // not JSON — try as base64-encoded data only
  }
  // 3. raw base64 of message data
  try {
    return parseRealtimeMessage(decodeBase64(raw));
  } catch {
    return undefined;
  }
};

export const parseTriggerEvent = (): ParsedEvent => {
  // Cloud Run Jobs Eventarc 経由: 第 1 引数に CloudEvent body
  const argRaw = process.argv[2];
  if (argRaw) {
    const parsed = tryParseEnvelope(argRaw);
    if (parsed) {
      return { kind: "pubsub", message: parsed };
    }
    console.warn("argv[2] present but failed to parse as Pub/Sub event; falling back");
  }

  // 手動 / 直接ターゲットの環境変数経路
  const envRaw = process.env["PUBSUB_MESSAGE"] ?? process.env["CE_DATA"];
  if (envRaw) {
    const parsed = tryParseEnvelope(envRaw);
    if (parsed) {
      return { kind: "pubsub", message: parsed };
    }
    console.warn("PUBSUB_MESSAGE/CE_DATA present but failed to parse; falling back");
  }

  return { kind: "none", reason: "no event payload" };
};
