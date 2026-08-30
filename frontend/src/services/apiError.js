const humanizeField = (value) => String(value || "")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

const formatValidationItem = (item) => {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";

  const message = typeof item.msg === "string"
    ? item.msg.replace(/^Value error,\s*/i, "")
    : "";
  if (!message) return "";

  const location = Array.isArray(item.loc) ? item.loc : [];
  const field = location
    .filter((part) => !["body", "query", "path", "header"].includes(String(part)))
    .at(-1);
  return field ? `${humanizeField(field)}: ${message}` : message;
};

export function getApiErrorMessage(detail, fallback) {
  if (typeof detail === "string" && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const messages = detail.map(formatValidationItem).filter(Boolean);
    if (messages.length) return messages.join(" ");
  }

  const objectMessage = formatValidationItem(detail);
  return objectMessage || fallback;
}
