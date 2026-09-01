import assert from "node:assert/strict";
import test from "node:test";
import { compareDistanceCards, FORFEIT_DISTANCE_KM, haversineKm } from "../src/lib/scoring";
import { byeCount, highestPowerOfTwoAtMost, locationsNeeded, openingRound, pairHighLow, rankingMatchCount, rosterCapacity } from "../src/lib/tournament";

test("haversine produces a realistic London to Paris distance", () => {
  const distance = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
  assert.ok(distance > 340 && distance < 350);
});

test("distance cards use total first and locations as deterministic ties", () => {
  assert.equal(compareDistanceCards([10, 20, 30], [20, 30, 40]), -1);
  assert.equal(compareDistanceCards([10, 50], [20, 40]), -1);
  assert.equal(compareDistanceCards([10, 50], [10, 50]), 0);
});

test("opening rounds create only the play-ins needed", () => {
  const plan = openingRound(Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(plan.targetSize, 8);
  assert.equal(plan.byes.length, 4);
  assert.equal(plan.pairings.length, 4);
  assert.equal(plan.phase, "play_in");
  assert.deepEqual(plan.byes, [1, 2, 3, 4]);
  assert.deepEqual(plan.pairings, [[5, 12], [6, 11], [7, 10], [8, 9]]);
});

test("byes go only to the seeds that skip a play-in", () => {
  assert.equal(byeCount(12), 4);
  assert.equal(byeCount(10), 6);
  assert.equal(byeCount(8), 0);
  assert.equal(byeCount(1), 0);
});

test("seeded rounds pair high versus low", () => {
  assert.deepEqual(pairHighLow([1, 2, 3, 4, 5, 6, 7, 8]), [[1, 8], [2, 7], [3, 6], [4, 5]]);
});

test("power-of-two groups seed high versus low instead of pairing in order", () => {
  const plan = openingRound([8, 10, 11, 12]);
  assert.equal(plan.phase, "knockout");
  assert.deepEqual(plan.byes, []);
  assert.deepEqual(plan.pairings, [[8, 12], [10, 11]]);
});

test("supported roster sizes have deterministic full-ranking match counts", () => {
  assert.equal(highestPowerOfTwoAtMost(14), 8);
  assert.equal(rankingMatchCount(8), 12);
  assert.equal(rankingMatchCount(10), 15);
  assert.equal(rankingMatchCount(12), 20);
  assert.equal(rankingMatchCount(14), 25);
});

test("location budget covers every match plus the qualifier when one is needed", () => {
  assert.equal(locationsNeeded(8, 3), 36);
  assert.equal(locationsNeeded(12, 3), 61);
  assert.equal(locationsNeeded(16, 3), 96);
});

test("roster capacity is the largest roster the validated pool can start", () => {
  assert.equal(rosterCapacity(locationsNeeded(12, 3), 3), 12);
  assert.equal(rosterCapacity(locationsNeeded(12, 3) - 1, 3), 11);
  assert.equal(rosterCapacity(0, 3), 1);
});

test("bye-only knockout pairings are settled before the play-in resolves", () => {
  for (const size of [5, 6, 7, 9, 10, 12, 13]) {
    const plan = openingRound(Array.from({ length: size }, (_, index) => index + 1));
    if (plan.phase !== "play_in") continue;
    const early = pairHighLow<number | null>([...plan.byes, ...plan.pairings.map(() => null)]);
    const settled = early.filter(([first, second]) => first !== null && second !== null);
    // Past half the bracket the play-in winners start facing each other, so nothing is settled.
    assert.equal(settled.length, Math.max(0, plan.targetSize / 2 - plan.pairings.length));

    for (let outcome = 0; outcome < 2 ** plan.pairings.length; outcome += 1) {
      const winners = plan.pairings.map((pairing, index) => pairing[(outcome >> index) & 1]);
      const survivors = [...plan.byes, ...winners].sort((left, right) => left - right);
      const resolved = pairHighLow(survivors);
      early.forEach(([first, second], index) => {
        if (first !== null && second !== null) assert.deepEqual(resolved[index], [first, second]);
      });
    }
  }
});

test("a forfeit always sorts behind the worst real guess", () => {
  const antipodes = [
    haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }),
    haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 }),
    haversineKm({ lat: 41.9, lng: 12.5 }, { lat: -41.9, lng: -167.5 }),
  ];
  for (const distance of antipodes) assert.ok(distance < FORFEIT_DISTANCE_KM);
  assert.ok(Math.max(...antipodes) > 20000);
});
