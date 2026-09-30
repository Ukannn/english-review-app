import type { GradeStatus } from "./contracts";

export interface FeedbackTextPart { text: string; changed: boolean }
export interface SpellingPresentation { original: FeedbackTextPart[]; suggestion: FeedbackTextPart[] }

// Present only corrections explicitly supplied by grading; this does not assess spelling.
export function spellingPresentation(answer: string, grade: GradeStatus): SpellingPresentation | null {
  if (grade.targetOutcome === "not_measured" || !grade.errorCategory?.toLowerCase().includes("spell")) return null;
  const pairs = grade.feedbackZh?.matchAll(/([a-z]+(?:['’\-][a-z]+)*(?:[ \t]+[a-z]+(?:['’\-][a-z]+)*)*)\s*[”’"'`]*\s*(?:→|->|应(?:该)?(?:改)?为|应改成|应写(?:成|为)|需(?:要)?(?:改|写)(?:为|成)|改为|改成|更正为|should\s+be|corrected\s+to)\s*[“‘"'`]*\s*([a-z]+(?:['’\-][a-z]+)*(?:[ \t]+[a-z]+(?:['’\-][a-z]+)*)*)/gi);
  const replacements = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const pair of pairs ?? []) {
    const wrongWords = pair[1].match(/[a-z]+(?:['’\-][a-z]+)*/gi)!;
    const correctedWords = pair[2].match(/[a-z]+(?:['’\-][a-z]+)*/gi)!;
    if (wrongWords.length !== correctedWords.length) continue;
    if (wrongWords.length > 1 && !answer.includes(pair[1]) && !grade.observedAnswer.includes(pair[1])) continue;
    wrongWords.forEach((word, index) => {
      const wrong = word.toLowerCase(), corrected = correctedWords[index];
      if (wrong === corrected.toLowerCase()) return;
      const prior = replacements.get(wrong);
      if (prior && prior !== corrected) ambiguous.add(wrong);
      replacements.set(wrong, corrected);
    });
  }
  ambiguous.forEach(word => replacements.delete(word));
  const original: FeedbackTextPart[] = [], suggestion: FeedbackTextPart[] = [];
  let cursor = 0;
  for (const word of answer.matchAll(/[a-z]+(?:['’\-][a-z]+)*/gi)) {
    const corrected = replacements.get(word[0].toLowerCase());
    if (!corrected) continue;
    const gap = answer.slice(cursor, word.index);
    if (gap) { original.push({ text: gap, changed: false }); suggestion.push({ text: gap, changed: false }); }
    original.push({ text: word[0], changed: true }); suggestion.push({ text: corrected, changed: true });
    cursor = word.index + word[0].length;
  }
  if (cursor === 0) return null;
  const end = answer.slice(cursor);
  if (end) { original.push({ text: end, changed: false }); suggestion.push({ text: end, changed: false }); }
  return { original, suggestion };
}
