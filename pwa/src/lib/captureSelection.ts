export interface CaptureSpan { text: string; start: number; end: number }
export interface CapturedSelection {
  rawText: string;
  span: CaptureSpan;
  sourceUrl: string;
  sourceTitle: string;
}

const excluded = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [hidden], [aria-hidden="true"], [data-capture-ui], nav, script, style';
const blocks = 'p, blockquote, li, pre, h1, h2, h3, h4, [lang="en"], div, article, section';
function elementFor(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

// Range offsets distinguish repeated words and include text inside inline marks.
export function captureSelection(selection: Selection | null, root: Element, sourceTitle: string): CapturedSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const startElement = elementFor(range.startContainer), endElement = elementFor(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)
    || startElement.closest(excluded) || endElement.closest(excluded)) return null;
  const selectedText = range.toString();
  if (!/[a-z]/i.test(selectedText)) return null;
  const block = elementFor(range.commonAncestorContainer)?.closest(blocks);
  if (!block || !root.contains(block) || block.closest(excluded)) return null;
  // Never pull hidden answers or editable drafts into the source context.
  if (block.querySelector(excluded)) return null;
  const rawText = block.textContent ?? "";
  if (!rawText.trim() || rawText.length > 20000) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  const leading = selectedText.length - selectedText.trimStart().length;
  const text = selectedText.trim();
  const start = offset + leading, end = start + text.length;
  if (!text || rawText.slice(start, end) !== text) return null;
  return {rawText, span: {text, start, end}, sourceTitle,
    sourceUrl: `${location.origin}${location.pathname}${location.hash}`};
}

export function mergeCaptureSpans(spans: CaptureSpan[], next: CaptureSpan, rawText: string): CaptureSpan[] {
  const ordered = [...spans, next].sort((a, b) => a.start - b.start);
  const merged: CaptureSpan[] = [];
  for (const span of ordered) {
    const previous = merged.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      previous.text = rawText.slice(previous.start, previous.end);
    } else merged.push({...span});
  }
  return merged;
}
