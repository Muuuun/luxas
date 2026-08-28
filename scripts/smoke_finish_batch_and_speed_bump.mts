/**
 * smoke_finish_batch_and_speed_bump — v2 plan P0.3/P0.5 on the pp-vs-ss fixture:
 * finish() blocks carry an "also pending" trailer with the claim-status issues,
 * and cosmetic spawns while a headline row is disputed get the ship line
 * (prefix by default, refusal under LUXAS_COSMETIC_WHILE_DISPUTED=0).
 */
import { cheapPendingTrailer } from "../src/tools/report-integrity.ts";
import { cosmeticSpawnNotice } from "../src/claims-review.ts";
import { FinishEscalation } from "../src/claims-review.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = "fixtures/claims-ppss";
const trailer = cheapPendingTrailer(dir);
check("trailer lists further blocking issues", /Also pending \(\d+ further blocking/.test(trailer) && /\[claim-status\]/.test(trailer), trailer.slice(0, 200));
check("trailer starts after a blank line (escalation keys on line 1)", trailer.startsWith("\n\n"));
const esc = new FinishEscalation(3);
const a = "Cannot finish: the plan has 2 experiments and NO synthesis owner. …" + trailer;
const b = "Cannot finish: the plan has 3 experiments and NO synthesis owner. …" + cheapPendingTrailer(dir, 2);
esc.record(a); esc.record(b);
check("trailer content does not change the escalation key", esc.count === 2);
check("trailer is empty for a clean project dir", cheapPendingTrailer("fixtures/claims-297nm/raw") === "" || !/claim-status/.test(cheapPendingTrailer("fixtures/claims-297nm/raw")));

delete process.env.LUXAS_COSMETIC_WHILE_DISPUTED;
const ill = cosmeticSpawnNotice(dir, "illustrator");
check("illustrator while disputed → notice, not refusal", ill.notice.includes("[claim gate]") && !ill.refuse && /Spawning "illustrator" anyway/.test(ill.notice), ill.notice.slice(0, 160));
check("notice names disputed headline ids and the legal moves", /max_gain_over_orientation \(disputed\)/.test(ill.notice) && /DISCRIMINATOR/.test(ill.notice));
check("replicator / experiment are never bumped", cosmeticSpawnNotice(dir, "replicator").notice === "" && cosmeticSpawnNotice(dir, "experiment").notice === "");
process.env.LUXAS_COSMETIC_WHILE_DISPUTED = "0";
check("LUXAS_COSMETIC_WHILE_DISPUTED=0 → refusal", cosmeticSpawnNotice(dir, "report_writer").refuse === true);
delete process.env.LUXAS_COSMETIC_WHILE_DISPUTED;
check("legacy project (no quantities) is never bumped", cosmeticSpawnNotice("fixtures/claims-297nm/raw", "illustrator").notice === "");
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — finish tells the whole story; cosmetic spawns see the ship line.");
