const EARTH_RADIUS_KM = 6371.0088;

/**
 * Stand-in distance for a player the admin forfeited. Antipodal points are the furthest any
 * real guess can land, so anything past that ceiling always sorts behind everyone who played.
 */
export const FORFEIT_DISTANCE_KM = 40075;

function radians(degrees: number) { return (degrees * Math.PI) / 180; }

export function haversineKm(actual: { lat: number; lng: number }, guess: { lat: number; lng: number }) {
  const latDelta = radians(guess.lat - actual.lat);
  const lngDelta = radians(guess.lng - actual.lng);
  const actualLat = radians(actual.lat);
  const guessLat = radians(guess.lat);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(actualLat) * Math.cos(guessLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** One player's card across the shared rounds every player faces. */
export type SharedRoundCard = {
  playerId: string;
  /** Breaks a tie by whoever was seeded higher going in. */
  seed: number | null;
  distances: number[];
  forfeited: boolean;
};

/**
 * The sprint's whole result: distances add up and the lowest total drafts first, so a great round
 * cannot be undone by one bad one and a forfeit's placeholder distance buries the card it is on.
 */
export function rankByTotalDistance(cards: SharedRoundCard[]) {
  return cards
    .map((card) => ({ ...card, distanceKm: card.distances.reduce((total, distance) => total + distance, 0) }))
    .sort((left, right) => left.distanceKm - right.distanceKm
      || (left.seed ?? Infinity) - (right.seed ?? Infinity));
}

export function compareDistanceCards(player1: number[], player2: number[]): -1 | 0 | 1 {
  const total1 = player1.reduce((sum, distance) => sum + distance, 0);
  const total2 = player2.reduce((sum, distance) => sum + distance, 0);
  if (total1 < total2) return -1;
  if (total1 > total2) return 1;

  for (let index = 0; index < Math.max(player1.length, player2.length); index += 1) {
    const distance1 = player1[index] ?? Number.POSITIVE_INFINITY;
    const distance2 = player2[index] ?? Number.POSITIVE_INFINITY;
    if (distance1 < distance2) return -1;
    if (distance1 > distance2) return 1;
  }
  return 0;
}
