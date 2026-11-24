// A form field's value that outlives the page: the hook (useLab) holds it, so a half-written policy is still there after a trip to another page.
// Reset and a new Reset clear every draft. `initial` is used until the visitor first changes the field.
export default function useDraft(lab, name, initial) {
  const value = Object.hasOwn(lab.drafts, name) ? lab.drafts[name] : initial;
  return [value, (next) => lab.setDraft(name, typeof next === "function" ? next(value) : next)];
}
