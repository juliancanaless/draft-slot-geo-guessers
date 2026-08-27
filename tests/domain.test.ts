import assert from "node:assert/strict";
import test from "node:test";
import { compareDistanceCards, haversineKm } from "../src/lib/scoring";
import { highestPowerOfTwoAtMost, openingRound, rankingMatchCount } from "../src/lib/tournament";

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
});

test("supported roster sizes have deterministic full-ranking match counts", () => {
  assert.equal(highestPowerOfTwoAtMost(14), 8);
  assert.equal(rankingMatchCount(8), 12);
  assert.equal(rankingMatchCount(10), 15);
  assert.equal(rankingMatchCount(12), 20);
  assert.equal(rankingMatchCount(14), 25);
});
