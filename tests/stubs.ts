const mem = () => { const m = new Map<string,string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
(globalThis as any).localStorage = mem(); (globalThis as any).sessionStorage = mem();
(globalThis as any).window = globalThis; (globalThis as any).document = { documentElement: { dataset: {} }, getElementById: () => null };
