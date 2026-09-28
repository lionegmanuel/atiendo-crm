/**
 * Unit tests for lib/lgpd/sla.ts — computeDueAt
 *
 * Verifies that the LGPD SLA calculator correctly skips:
 *  - Weekends (Saturday + Sunday)
 *  - Brazilian national holidays (fixed and moveable 2026-2030)
 */

import { describe, it, expect } from "vitest";
import { computeDueAt } from "@/lib/lgpd/sla";
import { HOLIDAYS_BR_ISO } from "@/lib/lgpd/holidays-br";

/** Parse a YYYY-MM-DD string as a UTC Date */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Format a Date back to YYYY-MM-DD (UTC) for assertions */
function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("computeDueAt — business day SLA calculator", () => {
  // -------------------------------------------------------------------------
  // 5 simple cases — no holidays, just weekends
  // -------------------------------------------------------------------------

  it("simple: Mon + 5 business days = next Mon (skips weekend)", () => {
    // 2026-05-04 is Monday; +5 business days = Mon 2026-05-11
    expect(fmt(computeDueAt(d("2026-05-04"), 5))).toBe("2026-05-11");
  });

  it("simple: Wed + 3 business days = Mon (skips weekend)", () => {
    // 2026-05-06 is Wed; +3 = Mon 2026-05-11 (Thu, Fri, Mon)
    expect(fmt(computeDueAt(d("2026-05-06"), 3))).toBe("2026-05-11");
  });

  it("simple: Fri + 2 business days = Tue (skips Sat+Sun)", () => {
    // 2026-05-08 is Fri; +2 = Mon 2026-05-11 and Tue 2026-05-12
    expect(fmt(computeDueAt(d("2026-05-08"), 2))).toBe("2026-05-12");
  });

  it("simple: Tue + 1 business day = Wed", () => {
    // 2026-05-05 is Tue; +1 = Wed 2026-05-06
    expect(fmt(computeDueAt(d("2026-05-05"), 1))).toBe("2026-05-06");
  });

  it("simple: Thu + 10 business days = Thu+2w (spans a weekend)", () => {
    // 2026-05-07 (Thu) + 10 business days: Fri, Mon, Tue, Wed, Thu, Fri, Mon, Tue, Wed, Thu
    // = Thu 2026-05-21
    expect(fmt(computeDueAt(d("2026-05-07"), 10))).toBe("2026-05-21");
  });

  // -------------------------------------------------------------------------
  // Edge: start date is not a business day
  // -------------------------------------------------------------------------

  it("start on Saturday: counting begins next Monday", () => {
    // 2026-05-09 is Saturday → first business day = Mon 2026-05-11
    // +15 from Mon = 3 full weeks = Mon 2026-06-01
    // Mon+15: Tue, Wed, Thu, Fri, Mon, Tue, Wed, Thu, Fri, Mon, Tue, Wed, Thu, Fri, Mon
    // = Mon 2026-06-01
    expect(fmt(computeDueAt(d("2026-05-09"), 15))).toBe("2026-06-01");
  });

  // -------------------------------------------------------------------------
  // Holiday cases
  // -------------------------------------------------------------------------

  it("2026-04-29 (Wed) + 15 úteis: pula Dia do Trabalho 01-05", () => {
    // Wed 2026-04-29 is a business day (first counting day = Thu 30)
    // 01/05 (Fri) is a holiday — skipped
    // Count: Thu30, skip Fri01(holiday), Mon04, Tue05, Wed06, Thu07, Fri08 = 6
    //        Mon11, Tue12, Wed13, Thu14, Fri15 = 11
    //        Mon18, Tue19, Wed20, Thu21 = 15
    // → Thu 2026-05-21... wait, Tiradentes is 04-21 (Tue), not in this window.
    // Let's recount from Thu 2026-04-30:
    //  day1 = Thu 30 Apr
    //  day2 = Fri 01 May? No — 01-May is Trabalho holiday → skip
    //  day2 = Mon 04 May
    //  day3 = Tue 05
    //  day4 = Wed 06
    //  day5 = Thu 07
    //  day6 = Fri 08
    //  day7 = Mon 11
    //  day8 = Tue 12
    //  day9 = Wed 13
    //  day10 = Thu 14
    //  day11 = Fri 15
    //  day12 = Mon 18
    //  day13 = Tue 19
    //  day14 = Wed 20
    //  day15 = Thu 21
    expect(fmt(computeDueAt(d("2026-04-29"), 15))).toBe("2026-05-21");
  });

  it("2026-04-30 (Thu) + 15 úteis pula 01/05 feriado + fim de semana", () => {
    // First day after 04-30: Fri 01 May is holiday → skip
    // Count starts Mon 04 May (day1), same as above but shifted by 1
    // day1=Mon 04, day2=Tue05, day3=Wed06, day4=Thu07, day5=Fri08
    // day6=Mon11, day7=Tue12, day8=Wed13, day9=Thu14, day10=Fri15
    // day11=Mon18, day12=Tue19, day13=Wed20, day14=Thu21, day15=Fri22
    expect(fmt(computeDueAt(d("2026-04-30"), 15))).toBe("2026-05-22");
  });

  it("2026-12-23 (Wed) + 15 úteis pula Natal + Ano Novo", () => {
    // 2026-12-25 = Natal (Fri), 2027-01-01 = Ano Novo (Fri)
    // day1=Thu24, skip Fri25(Natal), skip Sat26, skip Sun27
    // day2=Mon28, day3=Tue29, day4=Wed30, day5=Thu31
    // skip Fri01(AnoNovo), skip Sat02, skip Sun03
    // day6=Mon04, day7=Tue05, day8=Wed06, day9=Thu07, day10=Fri08
    // day11=Mon11, day12=Tue12, day13=Wed13, day14=Thu14, day15=Fri15
    expect(fmt(computeDueAt(d("2026-12-23"), 15))).toBe("2027-01-15");
  });

  it("2026-02-13 (Fri) + 15 úteis pula Carnaval 16-17/02", () => {
    // 2026-02-16 (Mon) = Carnaval Monday — holiday
    // 2026-02-17 (Tue) = Carnaval Tuesday — holiday
    // day1=Sat14? No, Sat → skip. Sun15 → skip.
    // First business day after Fri13: Mon16 is holiday, Tue17 is holiday → Wed18(day1)
    // day1=Wed18, day2=Thu19, day3=Fri20
    // day4=Mon23, day5=Tue24, day6=Wed25, day7=Thu26, day8=Fri27
    // day9=Mon02Mar, day10=Tue03, day11=Wed04, day12=Thu05, day13=Fri06
    // day14=Mon09, day15=Tue10
    expect(fmt(computeDueAt(d("2026-02-13"), 15))).toBe("2026-03-10");
  });

  // -------------------------------------------------------------------------
  // Sanity check on the holiday list
  // -------------------------------------------------------------------------

  it("HOLIDAYS_BR_ISO contains all 8 fixed holidays per year × 5 years = 40", () => {
    const fixedCount = HOLIDAYS_BR_ISO.filter((h) => {
      // Fixed holidays have a known suffix
      const md = h.slice(5); // MM-DD
      const fixed = [
        "01-01",
        "04-21",
        "05-01",
        "09-07",
        "10-12",
        "11-02",
        "11-15",
        "12-25",
      ];
      return fixed.includes(md);
    }).length;
    expect(fixedCount).toBe(8 * 5);
  });
});
