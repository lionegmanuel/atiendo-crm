/**
 * Brazilian national holidays 2026-2030.
 * Used by the LGPD SLA calculator to skip non-business days.
 *
 * Fixed holidays are the same date each year.
 * Moveable holidays (Carnival Mon/Tue, Good Friday, Corpus Christi)
 * are listed manually for 2026-2030.
 */

// Fixed annual holidays (MM-DD pattern repeated for each year 2026-2030)
const FIXED_HOLIDAYS: string[] = [];

const YEARS = [2026, 2027, 2028, 2029, 2030];
const FIXED_DATES = [
  "01-01", // Confraternização Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independência
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamação da República
  "12-25", // Natal
];

for (const year of YEARS) {
  for (const md of FIXED_DATES) {
    FIXED_HOLIDAYS.push(`${year}-${md}`);
  }
}

// Moveable holidays 2026-2030
const MOVEABLE_HOLIDAYS: string[] = [
  // 2026
  "2026-02-16", // Carnival Monday
  "2026-02-17", // Carnival Tuesday
  "2026-04-03", // Good Friday (Sexta-feira Santa)
  "2026-06-04", // Corpus Christi
  // 2027
  "2027-02-08", // Carnival Monday
  "2027-02-09", // Carnival Tuesday
  "2027-03-26", // Good Friday
  "2027-05-27", // Corpus Christi
  // 2028
  "2028-02-28", // Carnival Monday
  "2028-02-29", // Carnival Tuesday
  "2028-04-14", // Good Friday
  "2028-06-15", // Corpus Christi
  // 2029
  "2029-02-12", // Carnival Monday
  "2029-02-13", // Carnival Tuesday
  "2029-03-30", // Good Friday
  "2029-05-31", // Corpus Christi
  // 2030
  "2030-03-04", // Carnival Monday
  "2030-03-05", // Carnival Tuesday
  "2030-04-19", // Good Friday
  "2030-06-20", // Corpus Christi
];

export const HOLIDAYS_BR_ISO: string[] = [...FIXED_HOLIDAYS, ...MOVEABLE_HOLIDAYS];

const _holidaySet = new Set(HOLIDAYS_BR_ISO);

/**
 * Returns true if the given date falls on a Brazilian national holiday.
 * Comparison is done in America/Sao_Paulo timezone.
 */
export function isHolidayBR(date: Date): boolean {
  // Format: YYYY-MM-DD in São Paulo timezone
  const isoDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return _holidaySet.has(isoDate);
}
