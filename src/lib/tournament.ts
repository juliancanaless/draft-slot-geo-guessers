export type OpeningRound<T> = {
  targetSize: number;
  byes: T[];
  pairings: Array<[T, T]>;
  phase: "play_in" | "knockout";
};

export function highestPowerOfTwoAtMost(value: number) {
  if (!Number.isInteger(value) || value < 1) throw new Error("Roster size must be a positive integer.");
  return 2 ** Math.floor(Math.log2(value));
}

export function pair<T>(entrants: T[]): Array<[T, T]> {
  if (entrants.length % 2 !== 0) throw new Error("Cannot pair an odd number of entrants.");
  const pairings: Array<[T, T]> = [];
  for (let index = 0; index < entrants.length; index += 2) pairings.push([entrants[index], entrants[index + 1]]);
  return pairings;
}

export function openingRound<T>(entrants: T[]): OpeningRound<T> {
  if (entrants.length < 2) throw new Error("A ranking group needs at least two entrants.");
  const targetSize = highestPowerOfTwoAtMost(entrants.length);
  const playInMatchCount = entrants.length - targetSize;
  const byeCount = entrants.length - playInMatchCount * 2;

  if (playInMatchCount === 0) {
    return { targetSize, byes: [], pairings: pair(entrants), phase: "knockout" };
  }
  return {
    targetSize,
    byes: entrants.slice(0, byeCount),
    pairings: pair(entrants.slice(byeCount)),
    phase: "play_in",
  };
}

export function rankingMatchCount(size: number): number {
  if (!Number.isInteger(size) || size < 1) throw new Error("Roster size must be a positive integer.");
  if (size === 1) return 0;
  const targetSize = highestPowerOfTwoAtMost(size);
  const playInLosers = size - targetSize;
  let total = size - 1;
  if (playInLosers > 1) total += rankingMatchCount(playInLosers);
  for (let cohort = targetSize / 2; cohort > 1; cohort /= 2) total += rankingMatchCount(cohort);
  return total;
}

export function shuffled<T>(values: T[], random: () => number = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
