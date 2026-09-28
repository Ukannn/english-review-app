import { describe, expect, it } from "vitest";
import { ActiveTime } from "./activeTime";
describe("engaged foreground timing",()=>{
 it("caps idle time at sixty seconds and resumes with interaction",()=>{const t=new ActiveTime(0);expect(t.tick(true,30_000)).toBe(30);expect(t.tick(true,90_000)).toBe(30);expect(t.tick(true,120_000)).toBe(0);t.interact(120_000);expect(t.tick(true,125_000)).toBe(5);});
 it("does not accumulate background or network waits",()=>{const t=new ActiveTime(0);expect(t.tick(false,20_000)).toBe(0);t.interact(20_000);expect(t.tick(true,25_000)).toBe(5);expect(t.tick(false,90_000)).toBe(0);});
});
