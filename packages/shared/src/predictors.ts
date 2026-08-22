/**
 * 予想者(predictor)レジストリ。
 *
 * boatracecsv 側の `scripts/boatrace/predictors/registry.py` と
 * `predictor_id` を必ず同期させること。fun-site はこの ID を使って
 * CSV パス (`data/estimate/{predictor_id}/...`) を解決し、Pub/Sub
 * メッセージの `csv_type=index:{predictor_id}` を予想者に紐付ける。
 *
 * 新規予想者の追加: 必要なら `COMPONENT_LABELS` に新成分を足し、
 * `PREDICTORS` 配列に `PredictorSpec` を追加する。active にする場合は
 * `icon` / `badgeTailwindClass` も他の active 予想者と重複しない値で指定する
 * (レース詳細ページの的中表示がこのレジストリ駆動のため)。
 * 退役: 該当エントリの `status` を `"retired"` に変更する
 * (過去データと累計回収率は保持)。
 *
 * ID の命名規則: 退役後も同じ ID は **再利用しない**
 * (累計回収率の同一性のため)。`<バージョン>_<特徴>` 形式を推奨。
 */

/** 各予想者で採用しうる特徴量成分のキー。 */
export type ComponentKey =
  | "waku"
  | "course"
  | "racer"
  | "motor"
  | "motor2rate"
  | "motor4"
  | "exhibit"
  | "weather"
  | "tenkai";

/** Component key → 日本語ラベル (CSV 列名から成分への逆引きにも使う)。 */
export const COMPONENT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番pt",
  // v6_course で採用。場×レース番号×コース別の収縮済み1着率
  // (data/estimate/stadium/course_win_rate.csv) を実進入コース (daily は枠番) で
  // 引いた値。waku の代替成分。列名は N枠_コースpt。boatracecsv 側 registry.py と同期。
  course: "コースpt",
  racer: "選手pt",
  motor: "モーターpt",
  motor2rate: "モーター2連率pt",
  // v4_motor で採用。エキスパート評価 (平和島/唐津/大村/鳴門) でチューニングした
  // モーター能力指数。CSV 列名は motor と同じ「モーターpt」(ファイルは predictor_id
  // ごとに分かれるため衝突しない)。boatracecsv 側 registry.py と同期。
  motor4: "モーターpt",
  exhibit: "展示pt",
  weather: "気象pt",
  tenkai: "展開優位pt",
};

/** Component key → 短縮表示ラベル(UI バー凡例等で使う)。 */
export const COMPONENT_SHORT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番",
  course: "コース",
  racer: "選手",
  motor: "モーター",
  motor2rate: "M2連率",
  motor4: "モーター",
  exhibit: "展示",
  weather: "気象",
  tenkai: "展開",
};

/** Component key → バー / 凡例の色 (UI 描画専用)。 */
export const COMPONENT_COLORS: Readonly<Record<ComponentKey, string>> = {
  waku: "#3b82f6",
  course: "#6366f1",
  racer: "#22c55e",
  motor: "#f97316",
  motor2rate: "#14b8a6",
  motor4: "#ea580c",
  exhibit: "#a855f7",
  weather: "#06b6d4",
  tenkai: "#ec4899",
};

/**
 * daily 状態(朝バッチ)では未取得な preview 由来の成分。
 * UI 側はこれらを daily 評価では非表示にする。
 * `tenkai` (展開優位pt) はスタート展示の進入コースに依存するため preview 由来。
 */
export const PREVIEW_DERIVED_COMPONENTS: readonly ComponentKey[] = ["exhibit", "weather", "tenkai"];

/** `key` が preview 由来成分かを判定。 */
export function isPreviewDerivedComponent(key: ComponentKey): boolean {
  return PREVIEW_DERIVED_COMPONENTS.includes(key);
}

/** Component key → 欠損補完値 (偏差値pt スケール)。boatracecsv 側と同期。 */
export const COMPONENT_MISSING_FALLBACK: Readonly<Partial<Record<ComponentKey, number>>> = {
  racer: 30.0,
};
export const COMPONENT_MISSING_FALLBACK_DEFAULT = 50.0;

/** 予想者の運用状態。 */
export type PredictorStatus = "active" | "retired";

/** 1 予想者の宣言的定義。 */
export type PredictorSpec = {
  /** 予想者の固有 ID。退役後も再利用しない。 */
  readonly id: string;
  /** UI 表示名 (例: "本命予想")。 */
  readonly displayName: string;
  /**
   * 直前買い目が的中したことを示すアイコン (絵文字)。レース詳細ページの
   * レース番号リンクバーと、レース結果の的中バッジで使う。
   * **active な予想者では他と重複しない値を必ず指定する**
   * (アイコンだけでどの予想者が当たったか判別できるようにするため)。
   * 退役済みの予想者は表示機会が無いので未指定でよい。
   */
  readonly icon?: string;
  /**
   * 的中バッジの配色 (Tailwind v4 ユーティリティクラス)。`icon` とセットで指定する。
   * shared 配下の .ts も web の Tailwind スキャン対象 (`global.css` の `@source`)。
   */
  readonly badgeTailwindClass?: string;
  /** active な予想者の中での表示順。低いほど先頭に出る。 */
  readonly slot: number;
  /** "active" か "retired"。 */
  readonly status: PredictorStatus;
  /** この予想者で予想を出し始めた日 (累計回収率の起点、YYYY-MM-DD)。 */
  readonly startedAt: string;
  /** この予想者が使う特徴量キー (順序が CSV 列順)。 */
  readonly componentKeys: readonly ComponentKey[];
  /**
   * 1 マーク走行距離計算・スリット図の予測 ST に AI 推定 ST
   * (estimate/racer_st、実測 ST 履歴ベース) を使うか。未指定 (false) は
   * 従来どおり全国平均 ST。現状 v5_slit のみ true。
   */
  readonly useEstimatedST?: boolean;
  /**
   * 買い目候補を 1 マーク走行距離ではなく **強さpt のみ** で選定するか
   * (v8_aionly)。true なら各着の基準艇の強さpt ±5.0pt 窓で候補を取る
   * (距離式では強さpt/50 なので距離 ±0.1 と等価スケール。予測 ST は
   * 買い目に一切影響しない)。未指定 (false) は従来どおり走行距離基準。
   * バッチ / web は `bettingBasisFor(predictorId)` 経由でこのフラグを解決する。
   */
  readonly strengthOnlyBetting?: boolean;
  /**
   * 買い目の作り方。
   * - 未指定 / `"formation"`: 1 マーク走行距離(または強さpt)から
   *   フォームレーションを **fun-site 側で計算**する(既存の全予想者)。
   * - `"suji"`: boatracecsv が確定させた出目を **CSV から読む**だけ
   *   (`v9_suji`。`data/estimate/suji/YYYY/MM/DD.csv`)。
   * - `"kimarite"`: 同じく CSV から読む穴予想 B案
   *   (`v10_kimarite`。`data/estimate/kimarite/picks/YYYY/MM/DD.csv`)。
   *
   * `"suji"` / `"kimarite"` はどちらもフォーメーションでは表現できない
   * 出目集合になるため、fun-site 側では計算しない。値の違いは
   * **どの CSV を読むか**だけで、表示・集計の経路は共通。
   *
   * 解決は `bettingStyleFor(predictorId)` 経由で行う。バッチ(集計対象の買い目)と
   * web(表示する買い目)が食い違わないよう、必ず同じヘルパーを通すこと。
   */
  readonly bettingStyle?: "formation" | "suji" | "kimarite";
  /**
   * 予想者カードに AI 評価まわりの 3 パネル
   * (「AI 評価の内訳」チャート / 「スタート予想」図 / 「1マーク予想」図) を出すか。
   * 未指定 (= true) は従来どおり全て出す。
   *
   * **表示専用のフラグ**。買い目にも回収率にも集計にも影響しないので、
   * boatracecsv 側 registry.py に対応するフィールドは無い。
   *
   * false にするのは、買い目が CSV 由来 (`bettingStyle` が `"formation"` 以外) で
   * 1 マーク走行距離を使わない予想者 (`v9_suji` / `v10_kimarite`)。
   * 出したままだと「この図から買い目が出ている」と誤読させる。また 3 パネルは
   * 予想者間でほぼ同じ絵になるため、本命予想 (`v1_basic`) のカードに出ている
   * ぶんと重複する。
   *
   * 解決は `showsAiPanelsFor(predictorId)` 経由で行う。
   */
  readonly showsAiPanels?: boolean;
};

/**
 * 予想者レジストリ本体。
 *
 * v1_basic = "本命予想" (5 成分、control)。現行 active な control。
 * v2_tenkai = "モーター評価変更予想" (実験スロット)。着順ベースの motor を motor2rate
 * (公式モーター2連率) に置き換えた 5 成分構成。2026-07-19 退役 (control に有意差なし)。
 * v3_tenkai = "展開予想"。control の 5 成分に展開優位pt (tenkai) を加えた 6 成分版。
 * 2026-07-19 退役 (control に有意差なし)。
 * v4_motor = "モーター予想" (実験スロット)。control の motor をエキスパート評価で
 * チューニングした motor4 に差し替えた 5 成分版 (2026-07-20〜)。
 * v5_slit = "スリット予想" (実験スロット)。control と同一の 5 成分で、1 マーク距離
 * 計算・スリット図の予測 ST だけを AI 推定 ST (racer_st) に差し替えた版 (2026-07-21〜)。
 * v6_course = "コース予想"。control の waku を場×レース番号×コース別のコース強度
 * (course) に差し替えた 5 成分版 (2026-07-22〜)。2026-08-09 退役。
 * v7_aggregate = "統合予想"。v4_motor (motor→motor4) + v6_course (waku→course) の
 * 成分差し替えに、v5_slit の予測 ST 差し替え (useEstimatedST) を重ねた 3 仮説統合版
 * (2026-07-23〜)。2026-08-09 退役。
 * v8_aionly = "AI予想"。v7_aggregate と同一レシピ (index / 強さpt は同値) で、
 * 買い目候補の選定だけを 1 マーク走行距離 (予測 ST 込み) から強さpt のみ
 * (±5.0pt 窓、strengthOnlyBetting) に差し替えた版 (2026-07-28〜)。2026-08-09 退役。
 *
 * 2026-08-09 退役の 3 者 (v6_course / v7_aggregate / v8_aionly) は、control
 * (v1_basic) と同一レースで突き合わせたペア比較で回収率が有意に低かった
 * (それぞれ -6.91pt / -7.76pt / -10.62pt、Holm 補正後 p<0.05)。3 者に共通する
 * 差分は waku → course の差し替えで、course を持たない v4_motor / v5_slit は
 * control と同水準だったため course 成分が主因と判断した。検定の詳細は
 * boatracecsv 側 docs/data/estimate.md の「現行レジストリ」退役ノート参照。
 *
 * 退役後もエントリと過去データ (data/estimate/{id}/…)・成分定義
 * (tenkai / motor2rate / course) は保持する。命名規則どおり退役した ID は再利用しない
 * (累計回収率の同一性のため)。`activePredictors()` から除外されるので fetcher /
 * build-state / 各集計の対象から自動的に外れる。boatracecsv 側 registry.py と同期。
 */
export const PREDICTORS: readonly PredictorSpec[] = [
  {
    id: "v1_basic",
    displayName: "本命予想",
    icon: "🎯",
    badgeTailwindClass: "bg-amber-100 text-amber-800 border-amber-300",
    slot: 1,
    status: "active",
    startedAt: "2026-05-01",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
  },
  {
    id: "v2_tenkai",
    displayName: "モーター評価変更予想",
    slot: 2,
    // 2026-07-19 退役。control (v1_basic) に対し有意な回収率差が得られなかった。
    // boatracecsv 側 registry.py と同期。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // 着順ベースの motor を motor2rate (公式モーター2連率) に置き換えた 5 成分構成
    // (2026-06-13〜)。当初 (2026-05-30〜06-13) は展開優位pt (tenkai) を加えた 6 成分版だった。
    startedAt: "2026-06-13",
    componentKeys: ["waku", "racer", "motor2rate", "exhibit", "weather"],
  },
  {
    id: "v3_tenkai",
    displayName: "展開予想",
    slot: 3,
    // 2026-07-19 退役。control (v1_basic) に対し有意な回収率差が得られなかった。
    // boatracecsv 側 registry.py と同期。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // 本命予想 (control, v1_basic) の 5 成分に展開優位pt (tenkai) を加えた
    // 6 成分版 (2026-06-20〜)。tenkai はスタート展示の進入コース由来 (PREVIEW_DERIVED_COMPONENTS)。
    startedAt: "2026-06-20",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather", "tenkai"],
  },
  {
    id: "v4_motor",
    displayName: "モーター予想",
    slot: 4,
    // 2026-08-10 退役。control (v1_basic) との同一レース比較で +0.30pt
    // (95%CI [-2.4, +3.6], p=0.884, n=3035) と有意差なし。control との差が
    // motor → motor4 の 1 成分のみで買い目も大きく重なるため control 単独に戻した。
    // エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) の着順ベース motor を、エキスパート評価
    // (平和島/唐津/大村/鳴門 の 4 場) との順位相関でチューニングした motor4 に
    // 差し替えた 5 成分構成 (成分数は control と同じで motor 指標だけ差し替え)。
    // motor4 = スコア表 v4 (凸カーブ) + ペナルティ -50 + 直近 5 節。preview 非依存で
    // 朝バッチでも取得可。control と回収率を A/B 比較する実験スロット。
    startedAt: "2026-07-20",
    componentKeys: ["waku", "racer", "motor4", "exhibit", "weather"],
  },
  {
    id: "v5_slit",
    displayName: "スリット予想",
    slot: 5,
    // 2026-08-10 退役。control (v1_basic) との同一レース比較で -2.72pt
    // (95%CI [-7.0, +1.2], p=0.377, n=3035) と有意差なし。5 成分が control と
    // 完全に同一で差は予測 ST のみのため、買い目が control と大きく重なる。
    // エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) と同一の 5 成分 (index / 強さpt は同値) で、
    // 1 マーク走行距離計算とスリット図の予測 ST だけを全国平均 ST から
    // AI 推定 ST (estimate/racer_st。実測 ST 履歴の EWMA + コース/F 補正) に
    // 差し替えた実験スロット。ST 推定の改善単独の回収率効果を control と
    // A/B 比較する (boatracecsv docs/design/st_estimation.md)。
    startedAt: "2026-07-21",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
    useEstimatedST: true,
  },
  {
    id: "v6_course",
    displayName: "コース予想",
    slot: 6,
    // 2026-08-09 退役。control (v1_basic) との同一レース比較で回収率 -6.91pt
    // (95%CI [-13.1, -0.5], p=0.0047, n=3002)。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) の枠番pt (waku、場×季節×コース) を、
    // 場×レース番号×コース別の収縮済み1着率テーブルに基づくコースpt (course) に
    // 差し替えた 5 成分構成。テーブル定義の優劣だけを control と回収率で A/B
    // 比較する実験スロット。course は waku 同様 daily でも値を持つ
    // (PREVIEW_DERIVED_COMPONENTS には含めない)。
    // 設計: boatracecsv docs/design/course_strength_v6.md
    startedAt: "2026-07-22",
    componentKeys: ["course", "racer", "motor", "exhibit", "weather"],
  },
  {
    id: "v7_aggregate",
    displayName: "統合予想",
    slot: 7,
    // 2026-08-09 退役。control (v1_basic) との同一レース比較で回収率 -7.76pt
    // (95%CI [-13.9, -1.7], p=0.0040, n=2717)。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // 統合予想 = v4_motor / v5_slit / v6_course の 3 仮説を全て適用した版。
    //   - v6_course 由来: waku → course (場×レース番号×コース別の収縮済み1着率)
    //   - v4_motor  由来: motor → motor4 (スコア表 v4 + ペナルティ -50 + 直近 5 節)
    //   - v5_slit   由来: 予測 ST を全国平均 ST → AI 推定 ST (racer_st) に差し替え
    // componentKeys は course と motor4 を両取り。予測 ST 差し替えは index / 強さpt
    // には影響せず (成分は同一)、useEstimatedST フラグでのみ表現する。
    startedAt: "2026-07-23",
    componentKeys: ["course", "racer", "motor4", "exhibit", "weather"],
    useEstimatedST: true,
  },
  {
    id: "v9_suji",
    displayName: "スジ予想",
    icon: "🧩",
    badgeTailwindClass: "bg-violet-100 text-violet-800 border-violet-300",
    slot: 9,
    // 2026-08-22 退役。B案 v10_kimarite と穴予想スロットが重複するため。
    // **成績の劣化が理由ではない** — 本番 1,511 レース (両案同一レース) で
    // 買い目の重なりは平均 2.70 点 / 5 点あるのに、回収率は 70.7% (A) vs
    // 68.8% (B) で区別できない (差の検出に 8.2 ヶ月必要)。A案は確率モデルを
    // 持たず主判定の 3連単 log-loss に載らないため B案を残した。体験指標では
    // A案が上 (平均配当 3,949 円 vs 3,035 円 / 万舟per1万円 0.133 vs 0.066)。
    // エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // 穴予想 (A案)。control (v1_basic) と同一の 5 成分で index / 強さpt は同値。
    // 差分は買い目の作り方だけ:
    //   1着   = 1 コース以外で 強さpt が最大の艇
    //   2-3着 = スジ表 P(2着, 3着 | 1着) の上位 5 ペア
    // フォーメーションで表現できない出目集合になるため、買い目は boatracecsv が
    // data/estimate/suji/YYYY/MM/DD.csv に出したものをそのまま読む (bettingStyle)。
    // 設計・検証: boatracecsv docs/design/ana_prediction.md §13 (A案)
    startedAt: "2026-08-12",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
    bettingStyle: "suji",
    // 買い目がスジ表由来で 1 マーク走行距離を使わず、AI 評価の内訳は本命予想
    // (index / 強さpt が同値) のカードに出ているぶんと重複するため 3 パネルとも外す。
    showsAiPanels: false,
  },
  {
    id: "v10_kimarite",
    displayName: "穴予想",
    icon: "💎",
    badgeTailwindClass: "bg-cyan-100 text-cyan-800 border-cyan-300",
    slot: 10,
    status: "active",
    // boatracecsv 側 registry.py と同期。
    // 穴予想 (B案)。control (v1_basic) と同一の 5 成分で index / 強さpt は同値。
    // 差分は買い目の作り方だけ:
    //   Stage1  決まり手 × 1着コース の 32 クラス確率
    //   Stage2  セル条件付きの 2-3 着表 P(2着, 3着 | セル)
    //   合成    120 通り → Plackett-Luce(強さpt) と w:1−w でブレンド
    //   買い目  1 コース頭を除いた上位 5 点
    // A案 v9_suji と違い **1 レースの 5 点に複数の 1着艇が混ざる**。
    //
    // **A案との A/B は回収率では決着しない** (差 +4.2pt の検出に約 8.2 ヶ月)。
    // 主判定は boatracecsv 側で月次集計する 3連単 log-loss
    // (data/estimate/kimarite/tables/logloss.csv)。fun-site の回収率表示は
    // ガードレール (破滅的な劣化の検知) としてのみ使う。
    // 設計・検証: boatracecsv docs/design/ana_prediction.md §13 (B案)
    startedAt: "2026-08-13",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
    bettingStyle: "kimarite",
    // 買い目が決まり手×1着コースの確率表由来で 1 マーク走行距離を使わず、
    // AI 評価の内訳は本命予想 (index / 強さpt が同値) のカードに出ているぶんと
    // 重複するため 3 パネルとも外す。
    showsAiPanels: false,
  },
  {
    id: "v8_aionly",
    displayName: "AI予想",
    slot: 8,
    // 2026-08-09 退役。control (v1_basic) との同一レース比較で回収率 -10.62pt
    // (95%CI [-18.5, -2.9], p=0.0001, n=1892)。日次でも 13/13 日 control 未満。
    // エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // boatracecsv 側 registry.py と同期。
    // AI予想 = v7_aggregate と同一の 5 成分 (index / 強さpt は同値)。差分は
    // 買い目候補の選定方法のみ: 1 マーク走行距離 (予測 ST + 強さpt/50) 基準の
    // ±0.1 窓を、強さpt のみの ±5.0pt 窓 (等価スケール) に差し替える
    // (strengthOnlyBetting)。予測 ST が買い目に与える影響を外し、AI の
    // 強さ評価だけで買い目を組んだ場合の回収率を v7_aggregate と A/B 比較する。
    // useEstimatedST はスタート予想図・1マーク予想図の表示にのみ効き
    // (v7 と同じ AI 推定 ST 版)、買い目には影響しない。
    startedAt: "2026-07-28",
    componentKeys: ["course", "racer", "motor4", "exhibit", "weather"],
    useEstimatedST: true,
    strengthOnlyBetting: true,
  },
];

/** 登録されている全予想者 (active + retired) を返す。 */
export function allPredictors(): readonly PredictorSpec[] {
  return PREDICTORS;
}

/** `status === "active"` の予想者を slot 昇順で返す。 */
export function activePredictors(): readonly PredictorSpec[] {
  return PREDICTORS.filter((p) => p.status === "active").toSorted((a, b) => a.slot - b.slot);
}

/** ID で 1 件取得。見つからなければ `undefined`。 */
export function predictorById(id: string): PredictorSpec | undefined {
  return PREDICTORS.find((p) => p.id === id);
}

/** 的中表示 (アイコン / バッジ) に必要な予想者ごとの表示情報。 */
export type PredictorBadge = {
  /** 的中アイコン (絵文字)。 */
  readonly icon: string;
  /** バッジの配色 (Tailwind ユーティリティクラス)。 */
  readonly tailwindClass: string;
  /** "本命予想" → "本命"。「〜直前買い目 的中」の接頭辞に使う短縮名。 */
  readonly shortName: string;
};

/** レジストリに `icon` / `badgeTailwindClass` が無い予想者 (退役済み・未知 ID) 用。 */
const PREDICTOR_BADGE_FALLBACK = {
  icon: "🏁",
  tailwindClass: "bg-gray-100 text-gray-700 border-gray-300",
} as const;

/**
 * 予想者 ID → 的中バッジの表示情報。
 * 未登録の ID や `icon` 未指定の退役予想者でも描画できるようフォールバックする。
 */
export function getPredictorBadge(id: string, displayName?: string): PredictorBadge {
  const spec = predictorById(id);
  const name = spec?.displayName ?? displayName ?? id;
  return {
    icon: spec?.icon ?? PREDICTOR_BADGE_FALLBACK.icon,
    tailwindClass: spec?.badgeTailwindClass ?? PREDICTOR_BADGE_FALLBACK.tailwindClass,
    // "本命予想" → "本命"。サフィックスの無い名前 (ID 等) はそのまま使う。
    shortName: name.replace(/予想$/, ""),
  };
}

/**
 * `data/estimate/{predictor_id}/YYYY/MM/DD.csv` の **リポジトリ相対** パス
 * (BoatraceCSV リポジトリ内のパス。GCS の object key やフェッチ URL の
 * 末尾部分にもそのまま使える)。
 */
export function predictorCsvPath(
  predictor: PredictorSpec,
  date: { year: number; month: number; day: number },
): string {
  const yyyy = String(date.year).padStart(4, "0");
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `data/estimate/${predictor.id}/${yyyy}/${mm}/${dd}.csv`;
}

/**
 * Pub/Sub メッセージの csv_type (`index:v1_basic` 等) から
 * predictor を逆引きする。
 *
 * `csvType` が `"index:"` プリフィックスを持たない、または未知の ID
 * を含む場合は `undefined`。
 */
export function predictorFromIndexCsvType(csvType: string): PredictorSpec | undefined {
  const prefix = "index:";
  if (!csvType.startsWith(prefix)) return undefined;
  return predictorById(csvType.slice(prefix.length));
}

/** 予想者 `predictor` 用の Pub/Sub csv_type 文字列を組み立てる。 */
export function indexCsvTypeFor(predictor: PredictorSpec): string {
  return `index:${predictor.id}`;
}

/**
 * 予想者カードに AI 評価まわりの 3 パネル
 * (「AI 評価の内訳」/「スタート予想」/「1マーク予想」) を出すかを ID から解決する。
 * レジストリ (`PredictorSpec.showsAiPanels`) が唯一の情報源で、
 * 未登録 ID / 未指定なら既定の true。
 */
export function showsAiPanelsFor(predictorId?: string): boolean {
  if (!predictorId) return true;
  return predictorById(predictorId)?.showsAiPanels !== false;
}
