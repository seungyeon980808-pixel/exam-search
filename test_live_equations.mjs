import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { recoverEquationItems, recoverPiecewiseItems } from './live-equations.mjs';
import { buildLiveStructure } from './live-convert.mjs';

const item = (value, x, y, width = 5, height = 10) => ({ value, raw: value, x, y, width, height, math: true });
const bar = (x, y, width) => ({ ...item('\\frac', x, y, width, 1), raw: '\ue06d' });
const root = (x, y) => ({ ...item('\\sqrt', x, y), raw: '\ue05c' });
const head = (x, y) => ({ ...item('\\vec', x, y), raw: '\ue06e' });
const scenarios = [
  ['captured 2021 September ga25 adjacent lim and sum own separate lower limits', [item('lim', 115.4, 531.9, 18.7, 13.2), item('n', 114.1, 523.3, 4.5, 7.5), item('→', 119.6, 523.3, 7.4, 7.5), item('∞', 128, 523.3, 7.4, 7.5), item('\\sum', 138.1, 529.3, 14.3, 19.8), item('k', 136.9, 522.7, 3.9, 7.5), item('=', 142.1, 523.1, 5.8, 7.5), item('1', 149.7, 522.7, 3.7, 7.5), item('n', 142.9, 544.8, 4.5, 7.5), item('a', 154.6, 532.5, 6, 11)], 532.5, '\\lim_{n→∞}\\sum_{k=1}^{n}a'],
  ['captured 2020 November ga30 exponent overlaps the tall closing brace advance', [item('\\{', 540.1, 966.8, 6.4, 25.8), item('f', 545.4, 970.9, 5.4, 11), { ...item('′', 552, 970.9, 3, 11), math: false }, item('(', 555, 966.8, 4.3, 25.8), { ...bar(559.9, 967.4, 8.8), height: 11 }, item('1', 561.7, 978.1, 5.5, 11), item('3', 561.7, 963.6, 5.5, 11), item(')', 569.8, 966.8, 4.3, 25.8), item('\\}', 573.5, 966.8, 6.4, 25.8), item('2', 578.8, 983, 3.7, 7.5)], 970.6, '\\{f′(\\frac{1}{3})\\}^{2}'],
  ['captured 2021 November na20 integral cannot claim the preceding square', [item('x', 510.5, 921, 6.3, 11), item('2', 517.4, 925.9, 3.7, 7.5), item('\\int', 521.2, 917.9, 13.5, 22), item('x', 535.3, 931.7, 4.2, 7.5), item('0', 532.5, 911.3, 3.7, 7.5), item('f(t)dt', 539.9, 921, 29.3, 11)], 921.5, 'x^{2}\\int_{0}^{x}f(t)dt'],
  ['captured 2020 November ga08 integral bound retains its own exponent', [item('\\int', 107.3, 1010.6, 13.5, 22), item('e', 118.6, 1003.9, 3.5, 7.5), item('e', 121.4, 1024.4, 3.5, 7.5), item('2', 125.1, 1027.9, 2.5, 5.1), item('f(x)dx', 130, 1013.6, 45, 11)], 1013.3, '\\int_{e}^{e^{2}}f(x)dx'],
  ['captured 2017 November na28 text-font lim owns its lower condition', [{ ...item('lim', 449.7, 968.8, 18.7, 13.2), math: false }, item('n', 448.4, 960.1, 4.5, 7.5), item('→', 453.8, 960.1, 7.4, 7.5), item('∞', 462.2, 960.1, 7.4, 7.5), item('x', 473, 969.4, 6.3, 11)], 969.4, '\\lim_{n→∞}x'],
  ['captured 2017 November ga23 exponent belongs after tall closing parenthesis', [item('(', 499.7, 550.1, 4.3, 25.8), { ...bar(504.6, 550.7, 8.8), height: 11 }, item('1', 506.4, 561.4, 5.5, 11), item('2', 506.4, 546.8, 5.5, 11), item(')', 514.5, 550.1, 4.3, 25.8), item('x', 518.2, 566.3, 4.2, 7.5), item('-', 523.8, 566.6, 5.6, 7.5), item('5', 530.8, 566.3, 3.7, 7.5)], 553.8, '(\\frac{1}{2})^{x-5}'],
  ['captured 2017 June q18 primed text-font segment', [bar(556.86, 937.32, 18.6), { ...item('PF ′', 556.8, 933.42, 18.64, 10.98), math: false }], 933.42, '\\bar{PF′}'],
  ['captured 2017 November q29 text-font vector', [bar(135.9, 962.34, 15.78), head(148.8, 962.34), { ...item('OP', 136.2, 957.3, 15.12, 10.98), math: false }], 957.3, '\\vec{OP}'],
  ['captured 2025 June geometry q23 zero vector', [bar(259.14, 844.2, 7.98), head(264.24, 844.2), item('0', 260.76, 839.16, 5.52, 10.98)], 838.9791, '\\vec{0}'],
  ['captured 2018 September q21 denominator exponent spans the bar axis', [bar(236.2, 979.3, 25.9), item('1', 246.5, 990, 5.5, 11), item('2', 237.8, 973.6, 5.5, 11), item('n', 244, 978.4, 4.5, 7.5), item('-', 249.6, 978.8, 5.6, 7.5), item('2', 256.6, 978.4, 3.7, 7.5)], 982.7, '\\frac{1}{2^{n-2}}'],
  ['simple fraction', [bar(0, 0, 15), item('a', 3, 6), item('b', 3, -6)], 0, '\\frac{a}{b}'],
  ['fraction numerator suffix excluded', [bar(0, 0, 10), item('a', 2, 6), item('b', 2, -6), item('z', 15, 0)], 0, '\\frac{a}{b}z'],
  ['radical measured extent', [root(0, 8), bar(5, 8, 15), item('a', 6, 0), item('+', 11, 0, 3), item('b', 14, 0), item('+c', 22, 0)], 0, '\\sqrt{a+b}+c'],
  ['nested fractions', [bar(0, 0, 20), bar(3, 8, 10), item('a', 5, 14), item('b', 5, 3), item('c', 5, -7)], 0, '\\frac{\\frac{a}{b}}{c}'],
  ['fractional exponent', [item('x', 0, 0), bar(6, 6, 10), item('1', 8, 10, 3, 5), item('2', 8, 2, 3, 5)], 0, 'x^{\\frac{1}{2}}'],
  ['captured q8 even complete radical numerator fraction', [item('-', 218.16, 981.479, 8.34624, 10.98), bar(229.08, 977.51898, 26.16), item('5', 239.520004, 973.679077, 5.52, 10.98), { ...root(230.699997, 988.979004), width: 11.04, height: 12 }, bar(241.020004, 991.739014, 12.36), item('1', 241.199997, 988.138977, 5.52, 10.98), item('0', 246.480429, 988.138977, 5.52, 10.98)], 980.82384, '-\\frac{\\sqrt{10}}{5}'],
  ['captured q14 complete radical numerator fraction', [bar(567.900024, 556.559082, 31.44), item('5', 581.039978, 552.719116, 5.52, 10.98), item('8', 569.580458, 567.234676, 5.52, 10.98), { ...root(574.799988, 568.139099), width: 11.04, height: 12 }, bar(585.119995, 570.899109, 12.36), item('1', 585.299988, 567.239075, 5.52, 10.98), item('0', 590.58042, 567.239075, 5.52, 10.98)], 559.6191, '\\frac{8\\sqrt{10}}{5}'],
  ['captured negative fractional exponent coordinates', [item('3', 132.66, 895.3191, 5.52, 10.98), item('-', 138.18, 905.399, 7.8, 7.5), bar(145.98, 902.759, 6), item('2', 147.06, 900.1791, 3.72, 7.5), item('1', 147.06, 909.8991, 3.72, 7.5)], 895.019, '3^{-\\frac{1}{2}}'],
  ['expression subscript', [item('a', 0, 0), item('k', 6, -4, 3, 7), item('=', 9, -4, 3, 7), item('1', 12, -4, 3, 7)], 0, 'a_{k=1}'],
  ['simultaneous scripts', [item('x', 0, 0), item('i', 6, -4, 3, 7), item('2', 6, 4, 3, 7)], 0, 'x_{i}^{2}'],
  ['sum limits', [item('\\sum', 5, 0, 10), item('n', 8, 10, 4, 7), item('k=1', 4, -10, 12, 7), item('a', 22, 0)], 0, '\\sum_{k=1}^{n}a'],
  ['sum claims limits before preceding equals', [item('=', 0, 0), item('\\sum', 15, 0, 10, 18), item('k', 10, -8, 3, 7), item('=', 13, -8, 3, 7), item('1', 17, -8, 3, 7), item('n', 13, 10, 4, 7), item('+', 18, 10, 4, 7), item('1', 23, 10, 3, 7), item('a', 32, 0)], 0, '=\\sum_{k=1}^{n+1}a'],
  ['integral limits', [item('\\int', 5, 0, 10), item('1', 15, 8, 3, 7), item('0', 15, -8, 3, 7), item('x', 24, 0)], 0, '\\int_{0}^{1}x'],
  ['integral fractional limits remain siblings', [item('\\int', 514.25989, 885.59912, 13.5054, 22.02), { ...bar(526.31989, 876.65912, 6), height: 7.5 }, item('2', 527.46002, 874.01898, 3.72, 7.5), item('1', 527.46002, 883.79898, 3.72, 7.5), { ...bar(529.97998, 897.11908, 9.72), height: 7.5 }, item('4', 532.97998, 894.53912, 3.72, 7.5), item('2', 531.11998, 904.25912, 3.72, 7.5), item('7', 534.83998, 904.25912, 3.72, 7.5), item('g(t)dt', 540.59998, 888.65912, 35, 10.98)], 888.65912, '\\int_{\\frac{1}{2}}^{\\frac{27}{4}}g(t)dt'],
  ['captured q2 limit and fraction coordinates', [item('lim', 281.04, 557.9991, 18.67536, 13.2), item('h → 0', 281.64, 549.3591, 20.64, 7.5), bar(302.28, 555.2991, 73.26), item('h', 335.88, 551.5191, 6.35904, 10.98), item('f (1+ h)- f (1)', 305.27712, 566.03466, 69.09744, 10.98)], 558.5391, '\\lim_{h → 0}\\frac{f (1+ h)- f (1)}{h}'],
  ['split limit condition overlaps operator left', [item('lim', 10, 0, 15), item('h', 8, -8, 4, 7), item('→', 13, -8, 7, 7), item('0', 21, -8, 4, 7), item('f', 29, 0)], 0, '\\lim_{h→0}f'],
  ['per-character limit operator', [item('l', 10, 0, 4), item('i', 14, 0, 3), item('m', 17, 0, 8), item('h', 8, -8, 4, 7), item('→', 13, -8, 7, 7), item('0', 21, -8, 4, 7), item('f', 29, 0)], 0, '\\lim_{h→0}f'],
  ['captured calculus denominator exponent reaches fraction axis', [bar(205.98, 938.9391, 69.24), item('na', 208.98, 933.2391, 13.56, 10.98), item('n', 222.54, 930.2391, 6.72, 7.5), item('+5n', 229.26, 933.7791, 21.96, 10.98), item('2', 251.22, 938.0991, 5.94, 7.5), item('-2', 257.16, 933.7791, 15.30144, 10.98), item('(an', 220.56, 950.459, 16.62, 13.5), item('+2)', 237.18, 952.4391, 19.74, 10.98), item('2', 256.92, 956.8191, 3.72, 7.5)], 942.0591, '\\frac{(an+2)^{2}}{na_{n}+5n^{2}-2}'],
  ['captured q20 sum operator displaced baseline', [item('\\sum', 490.26, 921.7791, 14.2956, 19.8), item('k=1', 489.12, 915.1791, 16.56144, 7.5), item('n', 495.12408, 937.2591, 4.464, 7.5), item('a', 505.68, 925.0791, 6.18, 10.98), item('k', 511.86, 922.0791, 6.48, 7.5), item('=', 518.34, 925.6191, 11.7, 10.98), bar(530.04, 921.6591, 8.82), item('3', 531.78, 917.8191, 5.52, 10.98), item('2', 531.78, 932.40054, 8.15856, 10.98)], 925.0791, '\\sum_{k=1}^{n}a_{k}=\\frac{2}{3}'],
  ['vector head overlaps short bar', [bar(212.88, 909.7191, 4.5), head(214.5, 909.7191), item('b', 213.12, 904.67928, 4.8, 10.98), item('=', 225, 904.67928)], 904.67928, '\\vec{b}='],
  ['overbar excludes measured relation suffix', [bar(113.82, 1019.519, 15), item('A', 113.76, 1016.3391, 7.5, 10.98), item('B', 121.26, 1016.3391, 7.4, 10.98), item('=5', 132, 1016.3391, 15, 10.98)], 1015.4391, '\\bar{AB}=5'],
  ['vector arrow pair', [bar(0, 8, 12), head(12, 8), item('AB', 1, 0, 10)], 0, '\\vec{AB}'],
  ['overbar', [bar(0, 8, 12), item('AB', 1, 0, 10)], 0, '\\bar{AB}'],
  ['nuclear scripts', [item('14', 0, 4, 5, 7), item('6', 0, -4, 5, 7), item('C', 6, 0)], 0, '{}^{14}_{6}C'],
  ['unknown glyph retained', [item('\uefff', 0, 0)], 0, '\uefff'],
];
const rejected = [
  ['unbound radical', [root(0, 0), item('a', 6, 0)]],
  ['orphan fraction bar', [bar(0, 0, 10), item('1', 2, 6)]],
  ['numeric overbar ambiguity', [bar(0, 8, 10), item('1', 2, 0)]],
  ['unsplit structural run', [{ ...item('\\sqrt\\frac a', 0, 0, 20), raw: '\ue05c\ue06da' }]],
  ['ambiguous radical bar', [root(0, 8), bar(5, 8, 10), bar(5, 9, 12), item('a', 6, 0)]],
];
const results = [];
const placementScenarios = [
  ['captured 2020 November ga30 prime before a tall argument preserves one balanced equation', scenarios.find(([name]) => name.includes('exponent overlaps the tall closing brace'))[1], ['\\{f′(\\frac{1}{3})\\}^{2}']],
  ['captured 2019 November ga14 a long superscript cannot outvote the relation baseline', [item('(', 477.1, 959.3, 4.3, 25.8), { ...bar(482, 959.8, 8.8), height: 11 }, item('1', 483.7, 970.6, 5.5, 11), item('2', 483.7, 956, 5.5, 11), item(')', 491.9, 959.3, 4.3, 25.8), ...[...'f(x)g(x)'].map((value, index) => item(value, 495.6 + index * 3.8, 975.4, 3.5, 7.5)), item('≥', 529.4, 963.2, 9.3, 11)], ['(\\frac{1}{2})^{f(x)g(x)}≥']],
  ['captured 2019 November ga16 numerator ln is followed by its argument', [{ ...bar(669.8, 881.9, 17.6), height: 11 }, { ...item('ln', 671.5, 892.6, 9, 11), math: false }, item('2', 680.5, 892.6, 5.5, 11), item('3', 676, 878.1, 5.5, 11)], ['\\frac{\\ln 2}{3}']],
  ['captured 2018 September ga08 numerator ln cannot split integral upper limit', [item('\\int', 107.3, 1010.7, 13.5, 22), item('e', 121.4, 1024.5, 3.5, 7.5), item('1', 118.6, 1004, 3.7, 7.5), { ...bar(126.3, 1010.3, 37.6), height: 11 }, item('3', 129.4, 1021, 5.5, 11), item('(', 136, 1021.3, 4.3, 11.3), { ...item('ln', 139.7, 1021, 9, 11), math: false }, item('x', 148.7, 1021, 6.3, 11), item(')', 154.7, 1021.3, 4.3, 11.3), item('2', 158.5, 1025.9, 3.7, 7.5), item('x', 142.1, 1006.4, 6.3, 11), item('dx', 166.3, 1013.7, 11.6, 11)], ['\\int_{1}^{e}\\frac{3(\\ln x)^{2}}{x}dx']],
  ['captured 2024 November calculus25 denominator prime cannot anchor the equation line', [{ ...bar(147.5, 916.3, 64.9), height: 11 }, item('1', 177.3, 927, 5.5, 11), item('g', 149.1, 912.4, 5.3, 11), { ...item('′', 155.8, 912.4, 3, 11), math: false }, item('(f(x))f(x)', 158.8, 912.4, 52.5, 11), item('dx', 214.9, 919.7, 11.5, 11), item('=', 228.4, 920.2, 8.6, 11), item('2', 239, 919.7, 5.5, 11)], ['\\frac{1}{g′(f(x))f(x)}dx=2']],
  ['captured 2024 September calculus28 tall absolute delimiters never become integral limits', [item('g(x)=', 477.1, 879.5, 31.5, 11), item('|', 510.5, 874.2, 5.5, 28), item('\\int', 515.8, 876.5, 13.5, 22), item('x', 529.8, 890.3, 4.2, 7.5), item('-', 527.1, 870.2, 5.6, 7.5), item('a', 534.1, 869.8, 3.9, 7.5), item('{\\pi}', 537.9, 869.8, 4.2, 7.5), item('f(t)dt', 543.8, 879.5, 29.3, 11), item('|', 572.8, 874.2, 5.5, 28)], ['g(x)=|\\int_{-a{\\pi}}^{x}f(t)dt|']],
  ['captured 2023 June calculus27 sum limits cannot outvote a baseline operator', [item('\\sum', 130, 971.6, 14.3, 19.8), item('∞', 133.4, 987.2, 7.4, 7.5), item('n', 128.5, 965, 4.5, 7.5), item('=', 134.5, 965.4, 5.8, 7.5), item('1', 142, 965, 3.7, 7.5), item('(', 145.8, 971.4, 4.3, 28.1), { ...bar(150.7, 971.6, 14), height: 11 }, item('a', 152.3, 984.5, 5.8, 11), item('n', 158.5, 981.5, 4.5, 7.5), item('n', 154.6, 967.7, 6.6, 11), item('-', 167.1, 975.5, 8.3, 11), { ...bar(178, 971.6, 31.1), height: 11 }, item('3n+7', 179.6, 982.3, 28.1, 11), item('n+2', 182.3, 967.7, 22.8, 11), item(')', 210.2, 971.4, 4.3, 28.1)], ['\\sum_{n=1}^{∞}(\\frac{a_{n}}{n}-\\frac{3n+7}{n+2})']],
  ['captured 2018 June na26 denominator row cannot define a fraction equation baseline', [{ ...bar(478.2, 976.4, 13.3), height: 11 }, item('a', 479.9, 989.3, 5.8, 11), item('3', 486.1, 986.3, 3.7, 7.5), item('a', 479.9, 972.5, 5.8, 11), item('2', 486.1, 969.5, 3.7, 7.5), item('-', 495.4, 980.3, 8.3, 11), { ...bar(507.7, 976.4, 13.3), height: 11 }, item('a', 509.3, 989.3, 5.8, 11), item('6', 515.5, 986.3, 3.7, 7.5), item('a', 509.3, 972.5, 5.8, 11), item('4', 515.5, 969.5, 3.7, 7.5), item('=', 525.7, 980.3, 8.6, 11), { ...bar(538.7, 976.4, 8.8), height: 11 }, item('1', 540.5, 987.1, 5.5, 11), item('4', 540.5, 972.5, 5.5, 11)], ['\\frac{a_{3}}{a_{2}}-\\frac{a_{6}}{a_{4}}=\\frac{1}{4}']],
  ['captured 2021 June na17 integral upper limit and preceding cubic stay on their equation line', [item('f(x)=4', 128.5, 981.5, 39.1, 11), item('x', 167.6, 981.5, 6.3, 11), item('3', 173.6, 986.5, 3.7, 7.5), item('+', 179.6, 982.1, 8.6, 11), item('x', 189.4, 981.5, 6.3, 11), item('\\int', 195.4, 978.5, 13.5, 22), item('0', 206.6, 971.8, 3.7, 7.5), item('1', 209.4, 992.3, 3.7, 7.5), item('f(t)dt', 213.3, 981.5, 29.4, 11)], ['f(x)=4x^{3}+x\\int_{0}^{1}f(t)dt']],
  ['captured 2019 November ga16 tall parentheses cannot define standalone baseline', [item('f', 530.6, 983.5, 5.4, 11), item('(', 537.2, 979.5, 4.3, 25.8), { ...bar(542, 980, 9.3), height: 11 }, item('1', 544.1, 990.8, 5.5, 11), item('x', 543.7, 976.3, 6.3, 11), item(')', 552.5, 979.5, 4.3, 25.8), item('=', 559.9, 984.1, 8.6, 11), { ...bar(572.9, 980, 9.3), height: 11 }, item('1', 575, 990.8, 5.5, 11), item('x', 574.6, 976.3, 6.3, 11), item('+', 583.3, 984.1, 8.6, 11), item('1', 594.2, 983.5, 5.5, 11)], ['f(\\frac{1}{x})=\\frac{1}{x}+1']],
];
for (const [name, input, expected] of placementScenarios) {
  try {
    const glyphs = new Map(input.map((part, index) => [`eq:${part.raw === '\ue06d' ? 0xe06d : 0xe800 + index}`, part.value]));
    const pdf = { pageHeight: 1100, pageWidth: 800, fonts: { eq: { name: 'HyhwpEQ' }, text: { name: 'HYSinMyeongJo' } }, glyphs: [],
      content: { items: [{ str: '1. 구하시오.', transform: [11, 0, 0, 11, 20, 1050], width: 60, height: 11, fontName: 'text' },
        ...input.filter((part) => !part.math).map((part) => ({ str: part.value, transform: [part.height, 0, 0, part.height, part.x, part.y], width: part.width, height: part.height, fontName: 'text' }))] },
      equationItems: input.map((part, index) => ({ ...part, str: part.raw === '\ue06d' ? part.raw : String.fromCodePoint(0xe800 + index), transform: [part.height, 0, 0, part.height, part.x, part.y], width: part.width, height: part.height, fontName: 'eq' })).filter((part) => part.math) };
    const question = { id: 'captured-placement', no: 1, page: 1, box: [0, 0, 800, 300], responseType: 'short_answer', text: '1. 구하시오.' };
    const actual = buildLiveStructure(question, pdf, glyphs).blocks.flatMap((block) => block.runs || []).filter((run) => run.kind === 'equation').map((run) => run.script);
    assert.deepEqual(actual, expected);
    results.push({ scenario: name, pass: true, expected, actual });
  } catch (error) { results.push({ scenario: name, pass: false, error: error.message }); }
}
for (const [name, input, baseline, expected] of scenarios) {
  const before = structuredClone(input);
  try {
    const actual = recoverEquationItems(input, baseline).map((part) => part.value).join('');
    assert.equal(actual, expected);
    assert.deepEqual(input, before);
    results.push({ scenario: name, pass: true, expected, actual, inputUnchanged: true });
  } catch (error) { results.push({ scenario: name, pass: false, error: error.message }); }
}
for (const [name, input] of rejected) {
  try {
    assert.throws(() => recoverEquationItems(input, 0), /수식 구조/u);
    results.push({ scenario: name, pass: true, observable: 'throws structural ambiguity' });
  } catch (error) { results.push({ scenario: name, pass: false, error: error.message }); }
}
const brace = (value, y) => item(value, 0, y, 5, 11);
const piecewise = [brace('\\braceTop', 20), brace('\\braceMiddle', 10), brace('\\braceBottom', 0),
  item('x', 10, 20), item('(x<0)', 35, 20, 30), item('-x', 10, 0, 12), item('(x≥0)', 35, 0, 30)];
for (const [name, input, expected] of [
  ['complete piecewise rows', piecewise, 'cases{x & (x<0) # -x & (x≥0)}'],
  ['centered punctuation outside piecewise stays outside', [...piecewise, { ...item(',', 70, 10, 3, 11), math: false }], ',cases{x & (x<0) # -x & (x≥0)}'],
  ['wide gap before aligned piecewise condition', [brace('\\braceTop', 20), brace('\\braceMiddle', 10), brace('\\braceBottom', 0), item('a+(-1)^{n}×2', 10, 20, 67), item('(n is not a multiple of 3)', 89, 20, 100), item('a+1', 10, 0, 27), item('(n is a multiple of 3)', 89, 0, 80)], 'cases{a+(-1)^{n}×2 & (n is not a multiple of 3) # a+1 & (n is a multiple of 3)}'],
  ['incomplete piecewise brace rejected', piecewise.filter((part) => part.value !== '\\braceBottom'), null],
  ['orphan piecewise extender rejected', [brace('\\braceExtender', 8)], null],
  ['disconnected piecewise neighbor rejected', [...piecewise, item('unrelated', 200, 20, 40)], null],
]) {
  try {
    const before = structuredClone(input);
    if (expected === null) assert.throws(() => recoverPiecewiseItems(input), /수식 구조/u);
    else assert.equal(recoverPiecewiseItems(input).map((part) => part.value).join(''), expected);
    assert.deepEqual(input, before);
    results.push({ scenario: name, pass: true, expected });
  } catch (error) { results.push({ scenario: name, pass: false, error: error.message }); }
}
const capturedFixtures = [];
for (const file of ['equations-round2.json', 'equations-round2-alignment.json']) {
  capturedFixtures.push(...JSON.parse(await readFile(new URL(`./test-fixtures/${file}`, import.meta.url), 'utf8')));
}
for (const fixture of capturedFixtures) {
  const input = fixture.items.map(([value, x, y, width, height, math]) => ({ ...item(value, x, y, width, height), math }));
  const before = structuredClone(input);
  try {
    const actual = fixture.kind === 'equation'
      ? recoverEquationItems(input, fixture.baseline).map((part) => part.value).join('')
      : recoverPiecewiseItems(input).find((part) => part.value.startsWith('cases{'))?.value;
    assert.equal(actual, fixture.expected);
    assert.deepEqual(input, before);
    results.push({ scenario: fixture.id, pass: true, expected: fixture.expected, actual });
  } catch (error) { results.push({ scenario: fixture.id, pass: false, error: error.message }); }
}
if (process.env.EQUATION_CORPUS_DIR) {
  const registry = JSON.parse(await readFile(new URL('./data/editable/glyph-proofs.json', import.meta.url), 'utf8'));
  const glyphs = new Map(registry.fonts.flatMap((font) => font.glyphs.map((glyph) => [glyph.codepoint, glyph.formula])));
  const expectedCases = {
    common_odd_04: ['cases{3x-2 & (x<1) # x^{2}-3x+a & (x≥1)}'],
    common_odd_15: ['cases{-x^{2} & (x<0) # x^{2}-x & (x≥0)}', 'cases{ax+a & (x<-1) # 0 & (-1≤x<1) # ax-a & (x≥1)}'],
    common_odd_21: ['cases{-f(x) & (x<t) # f(x) & (x≥t)}'],
    probability_statistics_odd_27: ['cases{\\frac{|2x-1|}{12} & (x=0,1,2,3) # a & (x=4)}'],
  };
  for (const [name, expected] of Object.entries(expectedCases)) {
    const path = `${process.env.EQUATION_CORPUS_DIR}/2026_11_math_${name}.json`;
    try {
      const raw = JSON.parse(await readFile(path, 'utf8'));
      const [x0, y0, x1, y1] = raw.question.box;
      const mathFonts = new Set(raw.equationItems.map((part) => part.fontName));
      const tokens = [...raw.equationItems, ...raw.content.items.filter((part) => !mathFonts.has(part.fontName))]
        .filter((part) => part.str.trim() && part.transform[4] + part.width > x0 && part.transform[4] < x1
          && raw.pageHeight - part.transform[5] >= y0 - 3 && raw.pageHeight - part.transform[5] <= y1 + 3)
        .map((part) => ({ ...item([...part.str].map((char) => glyphs.get(char.codePointAt(0)) || char).join(''),
          part.transform[4], part.transform[5], part.width, part.height), raw: part.str, math: mathFonts.has(part.fontName) }));
      const actual = recoverPiecewiseItems(tokens).filter((part) => part.value.startsWith('cases{')).map((part) => part.value);
      assert.deepEqual(actual, expected);
      results.push({ scenario: `captured piecewise ${name}`, pass: true, source: path, expected, actual });
    } catch (error) { results.push({ scenario: `captured piecewise ${name}`, pass: false, source: path, error: error.message }); }
  }
}
const evidence = process.env.EQUATION_EVIDENCE_DIR || '/tmp/exam-formula-geometry-tests';
await mkdir(evidence, { recursive: true });
await writeFile(`${evidence}/geometry-tests.json`, JSON.stringify({
  invocation: `${process.env.EQUATION_CORPUS_DIR ? `EQUATION_CORPUS_DIR=${process.env.EQUATION_CORPUS_DIR} ` : ''}EQUATION_EVIDENCE_DIR=${evidence} node ${process.argv[1]}`,
  surface: 'pure geometry API; captured and synthetic adversarial PDF-coordinate fixtures',
  browserCorpusValidated: false, results,
}, null, 2));
console.log(JSON.stringify({ passed: results.filter((result) => result.pass).length,
  total: results.length, evidence: `${evidence}/geometry-tests.json`, failures: results.filter((result) => !result.pass) }, null, 2));
if (results.some((result) => !result.pass)) process.exitCode = 1;
