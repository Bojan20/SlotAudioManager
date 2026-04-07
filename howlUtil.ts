// howl-util.ts
import { Howler, Howl } from 'howler';

const spriteCache = new Map<string, Howl>();

function findHowl(sprite: string): Howl | null {
  const cached = spriteCache.get(sprite);
  if (cached) return cached;

  const howls: Howl[] = (Howler as any)._howls || [];
  for (const howl of howls) {
    const sprites: Record<string, unknown> = (howl as any)._sprite;
    if (sprites && sprite in sprites) {
      // Cache all sprites for this howl
      for (const key of Object.keys(sprites)) {
        spriteCache.set(key, howl);
      }
      return howl;
    }
  }

  console.warn(`[howlUtil] No howl contains sprite: ${sprite}`);
  return null;
}

export const howlUtil = {
  load(name: string, onReady?: () => void): void {
    const howl = findHowl(name);
    if (!howl) return;

    if ((howl as any)._state === 'loaded') {
      onReady?.();
      return;
    }

    if (onReady) {
      howl.once('load', onReady);
    }

    if ((howl as any)._state === 'unloaded') {
      howl.load();
    }
  },

  unload(name: string): void {
    const howl = findHowl(name);
    if (!howl) return;

    if ((howl as any)._state === 'loaded') {
      howl.stop();
      howl.unload();
    }
  },

  isLoaded(name: string): boolean {
    const howl = findHowl(name);
    return howl ? (howl as any)._state === 'loaded' : false;
  },
};