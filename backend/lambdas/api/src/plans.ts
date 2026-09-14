export interface Plan {
  id: string;
  name: string;
  priceUsd: number;
  storageBytes: number;
  maxUploadBytes: number;
}

const GB = 1024 ** 3;

export const PLANS: Record<string, Plan> = {
  starter: { id: "starter", name: "Starter", priceUsd: 10, storageBytes: 1 * GB, maxUploadBytes: 100 * 1024 ** 2 },
  pro: { id: "pro", name: "Pro", priceUsd: 50, storageBytes: 50 * GB, maxUploadBytes: 500 * 1024 ** 2 },
  business: { id: "business", name: "Business", priceUsd: 100, storageBytes: 200 * GB, maxUploadBytes: 2 * GB },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[id ?? ""] ?? PLANS.starter;
}
