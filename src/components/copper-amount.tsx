// 魔兽货币标准色价格：金币金(#ffd100)、银币银(#e8e8e8)、铜币铜(#b87333)。
// 如 12g99s99c → 12g(金) 99s(银) 99c(铜)。负数前缀继承外层颜色；
// hideSign 用于"亏损 X"这类文案，负号由文字表达时省略。
export function CopperAmount({ copper, hideSign = false }: { copper: number; hideSign?: boolean }) {
  const sign = copper < 0 && !hideSign ? "-" : "";
  const abs = Math.abs(copper);
  const g = Math.floor(abs / 10000);
  const s = Math.floor((abs % 10000) / 100);
  const c = abs % 100;
  return (
    <>
      {sign}
      {g > 0 && <span className="text-[#ffd100]">{g}g</span>}
      {s > 0 && <span className="text-[#e8e8e8]">{s}s</span>}
      {(c > 0 || (g === 0 && s === 0)) && <span className="text-[#b87333]">{c}c</span>}
    </>
  );
}
