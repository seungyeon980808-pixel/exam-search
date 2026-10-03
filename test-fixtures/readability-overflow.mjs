// Layout stress fixture, deliberately distinct from source-PDF fidelity evidence.
export const longQuestionSentinels = Array.from({ length: 36 }, (_, index) => `문장${String(index + 1).padStart(3, '0')}끝`);
export function longQuestionFixture() {
  return { questionId: 'qa-long-prose', sourceLabel: '긴 문항 보존 검증',
    question: { no: 1, subject: 'kor', responseType: 'short_answer' },
    paragraphs: longQuestionSentinels.map((sentinel) => [{ kind: 'text',
      value: `${sentinel} 긴 문항은 다음 페이지로 이어져도 모든 문장이 편집 가능한 글자로 남아 있어야 하며 본문 영역을 벗어나거나 글자를 누락해서는 안 된다.` }]) };
}
export function equationOverflowFixture() {
  return { questionId: 'qa-long-equation', sourceLabel: '긴 수식 명시적 거부 검증',
    question: { no: 1, subject: 'math', responseType: 'short_answer' },
    paragraphs: [[{ kind: 'text', value: '계산 ' }, { kind: 'equation', script: Array(120).fill('x').join('+') }]] };
}
