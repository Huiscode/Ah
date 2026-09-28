"use client";

// Three-box g/s/c money input that stores total copper.
export function MoneyInput({ value, onChange, fieldClass }: { value: number; onChange: (copper: number) => void; fieldClass: string }) {
  const gold = Math.floor(value / 10000);
  const silver = Math.floor((value % 10000) / 100);
  const copper = value % 100;

  const set = (g: number, s: number, c: number) => onChange(g * 10000 + s * 100 + c);

  return (
    <span className="inline-flex items-center gap-0.5">
      <input type="number" value={gold} onChange={(e) => set(Number(e.target.value) || 0, silver, copper)} className={fieldClass + " text-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"} style={{ width: 56 }} />
      <span className="text-wow-gold text-[10px]">g</span>
      <input type="number" value={silver} onChange={(e) => set(gold, Number(e.target.value) || 0, copper)} className={fieldClass + " text-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"} style={{ width: 36 }} />
      <span className="text-wow-silver text-[10px]">s</span>
      <input type="number" value={copper} onChange={(e) => set(gold, silver, Number(e.target.value) || 0)} className={fieldClass + " text-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"} style={{ width: 36 }} />
      <span className="text-wow-copper text-[10px]">c</span>
    </span>
  );
}
