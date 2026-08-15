/**
 * スタート予想図 (`StartPredictionDiagram`) とスタート結果図
 * (`StartResultDiagram`) が共有する座標系と艇の描画。
 *
 * 2 図は **同じ目盛りで見比べられること** が目的なので、レンジ・viewBox・
 * レーン高・艇の大きさはここ 1 箇所だけで定義する。片方だけ変えないこと。
 */

/**
 * 表示レンジ（秒）。負値側がフライング。
 *
 * 出遅れ (L) 判定の 1 秒手前まで見えるレンジ。span が 1.0 秒あるので、
 * 実際に出る ST はフライングから大出遅れまでクランプされずに収まり、
 * 1 艇身 (0.135 秒) は水面幅の約 13.5% になる。
 */
export const ST_MIN = -0.1;
export const ST_MAX = 0.9;
export const ST_SPAN = ST_MAX - ST_MIN;

export const VIEWBOX_W = 600;
export const VIEWBOX_H = 360;
/**
 * 艇番バッジ + コース番号ラベル分。
 *
 * 艇番は艇体の上ではなくここに出す。艇は 1 艇身 = 0.135 秒ぶんの長さがあるので、
 * ST が遅い艇ほど船尾が水面左端からはみ出す。艇体に番号を乗せると、その艇の
 * 番号だけ読めなくなってしまう（参照した BOAT RACE 公式のスタート情報図も、
 * 艇番は水面の外に別カラムで出している）。
 */
export const LEFT_PAD = 86;
/** ST 値ラベル分 */
export const RIGHT_PAD = 80;
export const TOP_PAD = 24;
export const BOTTOM_PAD = 36;
export const LANES = 6;
export const LANE_HEIGHT = (VIEWBOX_H - TOP_PAD - BOTTOM_PAD) / LANES;
export const TRACK_LEFT = LEFT_PAD;
export const TRACK_RIGHT = VIEWBOX_W - RIGHT_PAD;
export const TRACK_W = TRACK_RIGHT - TRACK_LEFT;

/** 図の地色。艇が水面からはみ出したぶんを隠すカーテンにも使う */
export const FIGURE_BG = "#eff6ff";
export const WATER_FILL = "#dbeafe";
export const LANE_LINE = "#bfdbfe";

export const ST_TICKS = [-0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * ST → x 座標。ST=0 がスタートライン。ST が大きいほど後方（左寄り）で、
 * 負値（フライング）はスタートラインより前（右寄り）。
 */
export const stToX = (st: number): number => {
  const clamped = Math.min(Math.max(st, ST_MIN), ST_MAX);
  return TRACK_RIGHT - ((clamped - ST_MIN) / ST_SPAN) * TRACK_W;
};

export const START_LINE_X = stToX(0);

/**
 * 1 艇身ぶんの時間 (秒)。
 *
 * スリット付近の艇速 80km/h = 22.22 m/s、艇長 3m なので
 * 3 / 22.22 ≒ 0.135 秒 で 1 艇身。**艇はこの時間ぶんの長さで描く**ので、
 * 図の上での前後の重なりがそのまま艇身差として読める。
 *
 * 参考にした BOAT RACE 公式のスタート情報図は艇画像 54px・目盛り約 178px/秒
 * (≒ 0.30 秒/艇身) で、実寸より 2 倍以上長い。ここでは物理どおりに合わせる。
 */
export const BOAT_LENGTH_SEC = 0.135;
/** 艇の幅（図の縦方向）。縦軸は距離軸ではないのでレーン内に収まる値を選ぶ */
export const BOAT_HEIGHT_PX = 26;

/**
 * 軸レンジ `span`・水面幅 `trackW` の図における 1 艇身の px。
 *
 * 1マーク予想図の横軸 (`(1 - 予測ST) + 強さpt/50 - 1.6`) も ST と同じ
 * 「秒」次元なので、同じ 0.135 秒 = 1 艇身の換算がそのまま使える。
 */
export const boatLengthPx = (span: number, trackW: number): number =>
  (BOAT_LENGTH_SEC / span) * trackW;

export const BOAT_LENGTH_PX = boatLengthPx(ST_SPAN, TRACK_W);

/**
 * 艇の舳先 x。レンジ外の艇でも舳先だけは水面に残す。
 * 船尾側は水面左端より左へはみ出すが、カーテンの矩形で隠す。
 */
export const clampBowXIn = (x: number, trackLeft: number, trackRight: number): number =>
  Math.min(Math.max(x, trackLeft + 12), trackRight);

/** スタート予想図・スタート結果図用（共有レイアウトの水面に収める） */
export const clampBowX = (x: number): number => clampBowXIn(x, TRACK_LEFT, TRACK_RIGHT);

/**
 * 舳先が左を向く図（1マーク予想図）用の舳先 x。右向きの `clampBowXIn` と鏡像で、
 * 船尾が右へ伸びるぶんだけ舳先を水面右端から内側に留める。
 */
export const clampBowXInLeft = (x: number, trackLeft: number, trackRight: number): number =>
  Math.min(Math.max(x, trackLeft), trackRight - 12);

/**
 * 真上から見た艇の輪郭パス。舳先 `(bowX, cy)` を進行方向の端に置き、船尾が
 * 反対側へ `len` 伸びる。ST は **舳先がスタートラインを通過した時刻** なので、
 * 円の中心ではなく舳先を値の位置に合わせる。
 *
 * `dir` は進行方向（`1` = 右向き、`-1` = 左向き）。図の中で艇が左へ進むなら
 * `-1` を渡して鏡像の艇を描く。
 */
const hullPath = (bowX: number, cy: number, len: number, dir: 1 | -1): string => {
  const half = BOAT_HEIGHT_PX / 2;
  const sternX = bowX - dir * len;
  // 舳先のテーパーが終わる位置（ここから船尾までは平行な舷）。
  // 艇は 1 艇身ぶんの長さがあり縦横比が細長いので、テーパーを長く取ると
  // 矢印に見えてしまう。艇幅と同程度に抑えて舳先を立てる。
  const shoulderX = bowX - dir * Math.min(len * 0.3, BOAT_HEIGHT_PX);
  const r = 5; // 船尾の角丸
  const rx = r * dir; // 横方向は船体の内側へ向かうよう向きで符号を反転する
  const top = cy - half;
  const bottom = cy + half;
  return [
    `M ${bowX} ${cy}`,
    `L ${shoulderX} ${top}`,
    `L ${sternX + rx} ${top}`,
    `Q ${sternX} ${top} ${sternX} ${top + r}`,
    `L ${sternX} ${bottom - r}`,
    `Q ${sternX} ${bottom} ${sternX + rx} ${bottom}`,
    `L ${shoulderX} ${bottom}`,
    "Z",
  ].join(" ");
};

/** 舳先が右を向く艇（進行方向が右の図＝スタート予想図・スタート結果図） */
export const boatHullPath = (bowX: number, cy: number, len: number = BOAT_LENGTH_PX): string =>
  hullPath(bowX, cy, len, 1);

/** 舳先が左を向く艇（進行方向が左の図＝1マーク予想図）。`boatHullPath` の鏡像 */
export const boatHullPathLeft = (bowX: number, cy: number, len: number = BOAT_LENGTH_PX): string =>
  hullPath(bowX, cy, len, -1);

/** コックピット（キャノピー）の中心 x。艇に見せるための陰影 */
export const boatCanopyX = (bowX: number, len: number = BOAT_LENGTH_PX): number =>
  bowX - len * 0.42;

/** 左向きの艇のコックピット中心 x（`boatCanopyX` の鏡像） */
export const boatCanopyXLeft = (bowX: number, len: number = BOAT_LENGTH_PX): number =>
  bowX + len * 0.42;

/** 左カラムの艇番バッジ（角丸正方形）の位置とサイズ */
export const BADGE_SIZE = 20;
export const BADGE_X = 2;
