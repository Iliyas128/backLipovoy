const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateRegisterInput({ name, email, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "Email обязателен";
  if (!EMAIL_RE.test(normalized)) return "Некорректный email";
  if (!password) return "Пароль обязателен";
  if (String(password).length < 6) return "Пароль — минимум 6 символов";
  const trimmedName = String(name || "").trim();
  if (trimmedName && trimmedName.length < 2) return "Имя должно быть не короче 2 символов";
  return null;
}

export function validateLoginInput({ email, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "Email обязателен";
  if (!EMAIL_RE.test(normalized)) return "Некорректный email";
  if (!password) return "Пароль обязателен";
  return null;
}
