"use client";

import { useEffect, useState } from "react";

// 与 localStorage 同步的 useState：刷新页面后筛选/排序等 UI 状态不丢失。
// 首渲染用初始值（避免 SSR 不匹配），挂载后从 localStorage 读取并覆盖。
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // 忽略损坏的缓存，保持初始值
    }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 隐私模式等写不进去时静默失败
    }
  }, [key, value, loaded]);

  return [value, setValue];
}
