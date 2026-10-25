import type { TelepathicTargetGeography } from "./types";

export const TARGET_GEOGRAPHY_POOL_VERSION = "geography_v1";
const areas: Array<[string, string, string]> = [
  ["europe","Europa","Europe"], ["north-america","Ameryka Północna","North America"],
  ["central-america","Ameryka Środkowa","Central America"], ["south-america","Ameryka Południowa","South America"],
  ["antarctica","Antarktyda","Antarctica"], ["arctic","Arktyka","Arctic"], ["africa","Afryka","Africa"],
  ["asia","Azja","Asia"], ["australia","Australia","Australia"], ["russia","Rosja","Russia"],
  ["poland","Polska","Poland"], ["germany","Niemcy","Germany"], ["france","Francja","France"],
  ["england","Anglia","England"], ["italy","Włochy","Italy"], ["spain","Hiszpania","Spain"],
  ["norway","Norwegia","Norway"], ["greece","Grecja","Greece"], ["turkey","Turcja","Turkey"],
  ["japan","Japonia","Japan"], ["china","Chiny","China"], ["india","Indie","India"], ["nepal","Nepal","Nepal"],
  ["pakistan","Pakistan","Pakistan"], ["afghanistan","Afganistan","Afghanistan"],
  ["saudi-arabia","Arabia Saudyjska","Saudi Arabia"], ["vietnam","Wietnam","Vietnam"], ["indonesia","Indonezja","Indonesia"],
  ["south-africa","Republika Południowej Afryki","South Africa"], ["egypt","Egipt","Egypt"], ["kenya","Kenia","Kenya"],
  ["nigeria","Nigeria","Nigeria"], ["morocco","Maroko","Morocco"], ["madagascar","Madagaskar","Madagascar"],
  ["mexico","Meksyk","Mexico"], ["brazil","Brazylia","Brazil"], ["chile","Chile","Chile"], ["argentina","Argentyna","Argentina"],
  ["usa","Stany Zjednoczone","United States"], ["canada","Kanada","Canada"], ["peru","Peru","Peru"],
  ["iceland","Islandia","Iceland"], ["greenland","Grenlandia","Greenland"], ["hawaii","Hawaje","Hawaii"],
  ["canary-islands","Wyspy Kanaryjskie","Canary Islands"], ["galapagos","Galapagos","Galapagos"],
  ["new-zealand","Nowa Zelandia","New Zealand"], ["fiji","Fidżi","Fiji"],
];
export const TARGET_GEOGRAPHY_POOL: readonly TelepathicTargetGeography[] = Object.freeze(areas.map(([areaId,labelPl,labelEn]) =>
  Object.freeze({ areaId,labelPl,labelEn,poolVersion: TARGET_GEOGRAPHY_POOL_VERSION })));

/** Uniform bounded integer, using rejection rather than modulo bias. */
export function geographyRandomIndex(bound: number): number {
  const limit = Math.floor(0x100000000 / bound) * bound;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % bound;
}
export function assignTargetGeographies(count: number, randomIndex = geographyRandomIndex): TelepathicTargetGeography[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid geography count.");
  const result: TelepathicTargetGeography[] = [];
  while (result.length < count) {
    const pool = [...TARGET_GEOGRAPHY_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("Invalid geography RNG result.");
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (result.at(-1)?.areaId === pool[0].areaId) [pool[0],pool[1]] = [pool[1],pool[0]];
    result.push(...pool.slice(0, count - result.length).map(area => ({ ...area })));
  }
  return result;
}
