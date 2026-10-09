export const STORE_NAME = "Studio Blank";
export const POLICY_EFFECTIVE_DATE = "October 9, 2026";

function getPublicValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getSupportContacts() {
  const email = getPublicValue(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
  const telegramUrl = getPublicValue(
    process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL,
  );

  return {
    email: email && email.includes("@") ? email : null,
    telegramUrl:
      telegramUrl && /^https:\/\/t\.me\/[A-Za-z0-9_]+\/?$/.test(telegramUrl)
        ? telegramUrl
        : null,
  };
}
