// A `*`-only glob matcher with no regex and no recursion: one backtrack point, so it is O(n*m) and cannot blow up on hostile input.
// Callers bound both strings (policy strings are at most 512 characters). `*` matches any run of characters, including none.
export function globMatch(pattern, text, ignoreCase = false) {
  const p = ignoreCase ? pattern.toLowerCase() : pattern;
  const t = ignoreCase ? text.toLowerCase() : text;
  let i = 0, j = 0, star = -1, mark = 0;
  while (j < t.length) {
    if (i < p.length && p[i] === '*') { star = i++; mark = j; }
    else if (i < p.length && p[i] === t[j]) { i++; j++; }
    else if (star >= 0) { i = star + 1; j = ++mark; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i++;
  return i === p.length;
}
