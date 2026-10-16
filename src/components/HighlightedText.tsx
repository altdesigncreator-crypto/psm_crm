import { Fragment } from 'react';

/** Renders `text` with every match of `pattern` wrapped in <mark>. The
 * pattern must have a single capture group around the whole alternation
 * (as `highlightPattern` builds), so String.split keeps the matches at
 * odd indices. */
export default function HighlightedText({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-warning/25 text-foreground rounded-sm px-0.5">{part}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
