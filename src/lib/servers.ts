// 服务器标识。曾支持双服（eu/cn，2026-10-18 A 方案：单系统 + server 维度，
// 存档按账号隔离 → 导入 AQ_SERVER_KEY 打标 → DB server 列 → 网页 ?server=）。
// 2026-11-08 用户删除国服客户端，Ah 收回欧服单服：cn 键/标签/切换全部移除，
// DB 的 server 列与查询签名保留（恒为 "eu"），未来如需再开双服可原样恢复。
export const DEFAULT_SERVER = "eu"; // 欧服 / 默认主服
export const SERVER_KEYS = ["eu"] as const;
export type ServerKey = (typeof SERVER_KEYS)[number];

import { L, type Lang } from "@/lib/i18n";

/** 服务器显示名（双语）：eu → EU / 欧服。 */
export function serverLabel(server: string, lang: Lang): string {
  if (server === "eu") return L(lang, "EU", "欧服");
  return server;
}

/** 解析 URL 的 ?server= 参数；任何非 eu 值（含旧链接的 cn）回退默认主服。 */
export function parseServer(raw: string | string[] | null | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "eu" ? "eu" : DEFAULT_SERVER;
}
