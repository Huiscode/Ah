import { prisma } from "@/lib/prisma";

export async function getAppState(key: string): Promise<string | null> {
  const row = await prisma.appState.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  await prisma.appState.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}
