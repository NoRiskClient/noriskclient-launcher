const STORAGE_KEY = 'analytics_user_id';

let cached: string | null = null;

export const getOrCreateInstallId = (): string => {
  if (cached) return cached;

  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  cached = id;
  return id;
};
