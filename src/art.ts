// Original vector portraits. The same silhouettes are used in cards and on
// the field; no remote images, fonts, or asset downloads are required.
const outline = "#193f40";
const eyes =
  '<ellipse cx="39" cy="25" rx="6" ry="7" fill="#fff8da"/><circle cx="41" cy="25" r="2.8" fill="#193f40"/>';
const leaves =
  '<path d="M31 54Q6 55 10 42Q26 40 31 54M33 54Q55 52 55 40Q38 40 33 54" fill="#4f9c63"/>';
const stem = '<path d="M31 56V29" stroke="#317956" stroke-width="6"/>';
const bodies: Record<string, string> = {
  woodpecker:
    '<path d="M16 23L17 5L28 15L35 4L39 20" fill="#d95c42"/><path d="M14 28Q8 49 31 53Q50 54 49 31Q45 12 27 16Z" fill="#cb6d3c"/><path d="M12 37L3 45L18 46M49 27L63 34L48 37" fill="#e7b54f"/><path d="M22 34Q23 50 37 45" fill="#f8dea0"/>' +
    eyes,
  owlbomb:
    '<path d="M12 15L12 4L25 16Q32 12 40 16L53 5L51 29Q61 55 32 57Q5 55 12 29Z" fill="#8c6c9d"/><path d="M15 28Q30 13 31 31Q34 13 50 28Q48 47 33 42Q16 47 15 28" fill="#f7dfb0"/><circle cx="23" cy="29" r="4" fill="#193f40"/><circle cx="42" cy="29" r="4" fill="#193f40"/><path d="M28 34L34 41L39 34" fill="#e7a247"/><path d="M22 49L26 53M39 49L43 53" stroke="#193f40"/>',
  frostswallow:
    '<path d="M24 29L3 8L12 39L4 58L29 45Q54 48 51 29Q47 16 34 21L47 3L27 20Z" fill="#6aaec6"/><path d="M26 34Q33 48 43 37" fill="#e1f3e7"/><path d="M50 28L62 32L50 35" fill="#e2bf6a"/>' +
    eyes +
    '<path d="M18 17L23 22M13 25L19 28" stroke="#e1f3e7"/>',
  dawn:
    stem +
    leaves +
    '<path d="M31 6Q42 -1 44 12Q60 11 53 25Q64 39 46 40Q39 56 29 42Q9 51 12 33Q-2 23 14 17Q14 1 31 6Z" fill="#edbc4e"/><circle cx="31" cy="25" r="14" fill="#fff0a8"/><circle cx="26" cy="23" r="2"/><circle cx="36" cy="23" r="2"/><path d="M26 30Q31 34 36 30" fill="none"/>',
  pea:
    stem +
    leaves +
    '<path d="M20 15Q7 20 15 39Q21 48 36 39L47 37V18L35 20Q28 12 20 15Z" fill="#81b95b"/><ellipse cx="48" cy="28" rx="10" ry="13" fill="#a8ce6d"/><ellipse cx="50" cy="28" rx="4" ry="7" fill="#265b4b"/><circle cx="25" cy="24" r="3" fill="#193f40"/>',
  shell:
    leaves +
    '<path d="M13 54Q5 12 32 6Q59 12 52 54Z" fill="#acb972"/><path d="M32 9V51M13 29L32 37L52 29M13 43L32 51L52 43" fill="none" stroke="#667348" stroke-width="3"/><path d="M21 20L28 24M42 20L35 24" stroke="#193f40" stroke-width="3"/>',
  frost:
    stem +
    leaves +
    '<path d="M19 9Q32 1 45 9L42 25L53 36Q43 47 32 40Q20 47 11 36L22 25Z" fill="#a0d6ce"/><path d="M20 29L32 35L44 29M32 15V35" fill="none" stroke="#568baf" stroke-width="3"/><circle cx="25" cy="23" r="2"/><circle cx="38" cy="23" r="2"/>',
  nest: '<path d="M27 59L29 25L40 25L40 59" fill="#99693e"/><path d="M9 29Q0 13 19 11Q20 -3 35 6Q51 -2 53 15Q68 27 54 39L13 40Z" fill="#489a74"/><path d="M17 35Q32 46 49 35L45 46L22 46Z" fill="#dbb476"/><ellipse cx="28" cy="37" rx="5" ry="8" fill="#f8ecd4"/><ellipse cx="40" cy="37" rx="5" ry="8" fill="#f8ecd4"/>',
  normal:
    '<path d="M17 45L8 53M24 49L22 60M42 49L45 59M49 44L58 51" stroke="#193f40" stroke-width="4"/><ellipse cx="35" cy="36" rx="22" ry="18" fill="#c47865"/><path d="M31 21L37 51" stroke="#8a514c"/><circle cx="18" cy="27" r="13" fill="#dba47e"/><path d="M12 15L8 6M22 15L27 5" stroke="#193f40"/><circle cx="13" cy="25" r="3"/>',
  runner:
    '<path d="M31 43L20 55L5 55M44 42L51 54L62 49M32 27L48 10" stroke="#193f40" stroke-width="4"/><path d="M15 28L45 17L58 31L43 47L19 41Z" fill="#df9a46"/><path d="M16 21L4 15M43 32L60 25" stroke="#ecdd98" stroke-width="4"/><circle cx="18" cy="29" r="10" fill="#e7bd77"/><circle cx="13" cy="27" r="3"/>',
  armor:
    '<path d="M15 45L9 57M29 49L28 61M45 48L49 60M52 41L61 50" stroke="#193f40" stroke-width="5"/><path d="M10 38Q9 6 39 11Q60 15 56 45L31 52Z" fill="#6f819a"/><path d="M34 13L32 48M15 27L33 34L55 28" fill="none" stroke="#aebfc2" stroke-width="4"/><path d="M10 24L3 18L5 35L17 37" fill="#b1b7a5"/><circle cx="13" cy="30" r="3"/>',
  swarm:
    '<path d="M18 43L7 50M28 48L26 59M41 45L51 55" stroke="#193f40" stroke-width="3"/><ellipse cx="34" cy="35" rx="20" ry="14" fill="#ac85ac"/><circle cx="16" cy="31" r="11" fill="#dab0c5"/><path d="M13 21L9 13M20 21L25 13" stroke="#193f40"/><circle cx="12" cy="29" r="3"/><path d="M31 24L34 44M42 24L45 41" stroke="#875d91"/>',
};

export function portrait(id: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${outline}" stroke="${outline}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${bodies[id] ?? bodies.dawn}</g></svg>`;
}
export function portraitUrl(id: string): string {
  return "data:image/svg+xml;base64," + btoa(portrait(id));
}
export const PORTRAIT_IDS = Object.keys(bodies);
