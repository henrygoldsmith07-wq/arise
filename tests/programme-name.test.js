import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nameForDays, sessionsPerWeek } from "../src/lib/programmeName.js";
import { generateProgramme } from "../src/lib/programmeGenerator.js";

describe("programme naming truth", ()=>{
  it("rewrites the N×Week token to the real days", ()=>{
    assert.equal(nameForDays("Strength 4×Week", 3), "Strength 3×Week");
    assert.equal(nameForDays("Full Gym 4×Week", 4), "Full Gym 4×Week");
  });
  it("leaves other names and invalid days alone", ()=>{
    assert.equal(nameForDays("Rider Upper", 3), "Rider Upper");
    assert.equal(nameForDays("Strength 4×Week", 0), "Strength 4×Week");
    assert.equal(nameForDays("Strength 4×Week", null), "Strength 4×Week");
  });
  it("sessionsPerWeek takes the busiest week", ()=>{
    assert.equal(sessionsPerWeek([{week:1},{week:1},{week:2}]), 2);
    assert.equal(sessionsPerWeek([]), null);
  });
  it("a Full Gym 4×Week template resampled to 2 or 3 days is labelled with the real days", ()=>{
    const eq = ["barbell","dumbbell","machine","cable","bodyweight","bench","rack"];
    for(const d of [2,3,4]){
      const out = generateProgramme({ goal: "strength", daysPerWeek: d, level: "Beginner", availableEquipment: eq, startDateISO: "2026-10-26" });
      assert.equal(sessionsPerWeek(out.sessions), d);
      assert.ok(out.name.includes(`${d}×Week`), `${out.name} for ${d} days`);
    }
  });
});
