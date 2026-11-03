// 落款日期：干支纪年 + 季节，如“丙午秋”。
// 年份按立春换算，季节按“四立”节气划分；节气日期取常见值，前后最多差一天。
const STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const TERMS = [[2, 4, '春'], [5, 5, '夏'], [8, 7, '秋'], [11, 7, '冬']];

export function ganzhiSeason(date = new Date()) {
  const y = date.getFullYear(), md = (date.getMonth() + 1) * 100 + date.getDate();
  const year = md < 204 ? y - 1 : y;
  let season = '冬';
  for (const [m, d, name] of TERMS) if (md >= m * 100 + d) season = name;
  const k = ((year - 4) % 60 + 60) % 60;
  return STEMS[k % 10] + BRANCHES[k % 12] + season;
}
