// 服务端组件的语言解析：读 wah_lang cookie（LangToggle 写入 + router.refresh()）。
// 无 cookie 时回退英文默认。独立成文件是因为 next/headers 只能在服务端引入，
// 不能被客户端组件经 i18n.ts 间接带进来。
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "@/lib/i18n";

export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  return parseLang(jar.get(LANG_COOKIE)?.value);
}
