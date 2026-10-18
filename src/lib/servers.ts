// 双服务器标识（2026-10-18 A 方案：单系统 + server 维度，数据严格分服）。
// server 短标识贯穿：插件存档按账号天然隔离 → 导入 AQ_SERVER_KEY 打标 →
// DB server 列 → 网页 ?server= 参数。禁止在任意层混服。
export const DEFAULT_SERVER = "eu"; // 欧服 / 默认主服
export const SERVER_KEYS = ["eu", "cn"] as const;
export type ServerKey = (typeof SERVER_KEYS)[number];

export const SERVER_LABELS: Record<string, string> = {
  eu: "欧服",
  cn: "中国服"
};

/** 解析 URL 的 ?server= 参数；未知/缺省回退默认主服。 */
export function parseServer(raw: string | string[] | null | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "cn" ? "cn" : DEFAULT_SERVER;
}
