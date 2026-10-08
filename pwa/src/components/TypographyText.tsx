// Protect only short, editorial Chinese endings. The original text (including
// punctuation and spaces) stays intact for selection, copying and accessibility.
const words = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "word" }) : null;

export function TypographyText({ text }: { text: string | null }) {
  if (!text) return text;
  const ending = text.match(/[\p{Script=Han}]+[。！？!?…」』）】]*$/u);
  if (!ending || ending[0].length < 2) return text;
  let start = text.length - ending[0].length;
  if (words) {
    const segments = Array.from(words.segment(text));
    let characters = 0;
    for (let index = segments.length - 1; index >= 0; index--) {
      const segment = segments[index];
      if (segment.isWordLike && !/^[\p{Script=Han}]+$/u.test(segment.segment)) return text;
      characters += Array.from(segment.segment.match(/[\p{Script=Han}]/gu) ?? []).length;
      if (characters >= 2) { start = segment.index; break; }
    }
  } else {
    const tail = text.match(/[\p{Script=Han}]{2}[。！？!?…」』）】]*$/u);
    if (!tail) return text;
    start = text.length - tail[0].length;
  }
  // A long unbreakable chunk would crowd the narrowest layouts.
  if (text.length - start > 8) return text;
  return <>{text.slice(0, start)}<span className="typography-keep">{text.slice(start)}</span></>;
}
