/** Both catalog ID families identify the subject without loading every detail shard. */
export function questionSubject(id, subjects) {
  if (typeof id !== 'string') return undefined;
  // Expanded papers use YEAR_MONTH_SUBJECT_TRACK_VARIANT_NUMBER. Science
  // uses SUBJECT_YEAR_MONTH_NUMBER. Match whole subject tokens, including '_'.
  const legacy = id.replace(/^\d{4}_\d{2}_/u, '');
  return subjects.find(({ value }) => id.startsWith(`${value}_`) || legacy.startsWith(`${value}_`))?.value;
}
