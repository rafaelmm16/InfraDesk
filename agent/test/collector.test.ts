import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectEndpointSnapshot,
  computeCpuPercentFromTicks,
  parseDfPosixLine,
} from "../src/collector.ts";

describe("InfraDesk Endpoint Agent Collector", () => {
  it("calculates CPU busy percentage from tick deltas", () => {
    const pct = computeCpuPercentFromTicks(
      { idle: 1000, total: 2000 },
      { idle: 1250, total: 3000 } // 250 idle out of 1000 delta -> 75% busy
    );
    assert.equal(pct, 75);
  });

  it("parses POSIX df -Pk output accurately", () => {
    const sample = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/nvme0n1p2   524288000 262144000 262144000      50% /",
    ].join("\n");
    const parsed = parseDfPosixLine(sample);
    assert.ok(parsed);
    assert.equal(parsed.diskTotalGb, 500);
    assert.equal(parsed.diskPercent, 50);
  });

  it("collects a valid live snapshot on the current host", async () => {
    const snap = await collectEndpointSnapshot({
      adOu: "OU=Engenharia,DC=corp,DC=local",
      department: "Engenharia",
    });
    assert.ok(snap.hostname.length > 0);
    assert.equal(snap.department, "Engenharia");
    assert.ok(snap.cpuPercent >= 0 && snap.cpuPercent <= 100);
    assert.ok(snap.ramPercent > 0 && snap.ramPercent <= 100);
    assert.ok(snap.ramTotalGb >= 1);
  });
});
