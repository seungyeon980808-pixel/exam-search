// HWP sizes use hundredths of a point; layout metrics use CSS pixels.
export const typography = Object.freeze({ body: 1000, equation: 1000, source: 800,
  minimumEquation: 800, lineSpacing: 145, cellPadding: 220 });
export const bodyCharFormat = Object.freeze({ fontSize: typography.body });
export const paragraphFormat = Object.freeze({ lineSpacing: typography.lineSpacing,
  lineSpacingType: 'Percent', spacingBefore: 0, spacingAfter: 0 });
export const hwpToPixels = (size) => size / 75;
