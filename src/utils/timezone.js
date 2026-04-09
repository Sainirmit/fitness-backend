export function isValidIanaTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function getHeaderTimeZone(req) {
  const raw = req.headers["x-timezone"];
  if (typeof raw !== "string") return null;
  const tz = raw.trim();
  return isValidIanaTimeZone(tz) ? tz : null;
}

export function resolveTimeZone(req, user, options = {}) {
  const { queryKey = "timeZone", bodyKey = "timeZone" } = options;
  const fromHeader = getHeaderTimeZone(req);
  if (fromHeader) return fromHeader;

  const fromQuery = req.query?.[queryKey];
  if (typeof fromQuery === "string" && isValidIanaTimeZone(fromQuery.trim())) {
    return fromQuery.trim();
  }

  const fromBody = req.body?.[bodyKey];
  if (typeof fromBody === "string" && isValidIanaTimeZone(fromBody.trim())) {
    return fromBody.trim();
  }

  if (isValidIanaTimeZone(user?.timeZone)) {
    return user.timeZone.trim();
  }

  return "UTC";
}

export async function syncUserTimeZoneFromHeader(req, user) {
  const headerTz = getHeaderTimeZone(req);
  if (!headerTz) return false;
  if (user.timeZone === headerTz) return false;

  user.timeZone = headerTz;
  await user.save();
  return true;
}
