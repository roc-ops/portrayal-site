// THE WORDS FOR A CABLE MANAGER'S CAPACITY (kit 0.40.0, Portrayal #1074).
// rack.json gives `capacity: {count, basis, media?, estimated?}`. Seven FS
// managers state no count, and the library carries an estimate for them
// (`estimated: true`); the kit says so wherever it reads one ("an estimated 54
// cat6 cables' worth (its maker states none)"), and so does the page. A count
// the maker states is worded as it always was.

/** The capacity line of the inspector and the zero-U panel. */
export function capacityText(cap) {
  if (cap.estimated !== true) return `${cap.count} cables (${cap.basis})`;
  return `${estimatedWords(cap.count, cap.media)} (its maker states none): ${cap.basis}`;
}

/** "an estimated 54 cat6 cables' worth", the kit's phrase (slack.js loadText). */
export const estimatedWords = (count, media) =>
  `an estimated ${count} ${media ? `${media} ` : ''}${count === 1 ? "cable's" : "cables'"} worth`;
