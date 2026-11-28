export interface VanillaCape {
  id: string;
  name: string;
  description?: string;
  url: string;
  equipped: boolean;
  obtainedAt?: number;
  category: string;
  active: boolean;
}