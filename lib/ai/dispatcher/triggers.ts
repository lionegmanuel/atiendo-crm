/**
 * Trigger matching helper for the agent-dispatcher (S-13.07).
 *
 * Decide if a published agent version should respond to a given inbound
 * message. Spec 10 §5.3: events + filters {ignore_groups, ignore_self,
 * keyword_regex, business_hours}. The dispatcher fans every candidate through
 * `triggerMatches`; the first match (sorted priority desc, created_at asc)
 * wins.
 *
 * Schema realities (the spec talks about WAHA payload, but at dispatch time we
 * only have rows from `messages` + `conversations`):
 *  - `chat_id ends with @g.us` → `conversations.is_group === true` OR
 *    `conversations.group_chat_id is not null`. The webhook persists those
 *    flags so the dispatcher does not need to re-parse the WAHA payload.
 *  - `from_me` → `messages.direction === 'outbound'`. Inbound messages from
 *    the customer are always `direction='inbound'`. We still defend against
 *    operator devices that might emit fromMe events into the queue.
 */

export interface TriggerConfig {
  events: string[];
  filters: {
    ignore_groups?: boolean | null;
    ignore_self?: boolean | null;
    keyword_regex?: string | null;
    business_hours?: BusinessHoursConfig | null;
  };
  concurrency?: string;
}

export interface BusinessHoursConfig {
  /** IANA tz, e.g. "America/Sao_Paulo". Defaults to UTC. */
  tz?: string | null;
  /** ["mon","tue",...] lowercase abbrev. Defaults to Mon-Fri. */
  days?: string[] | null;
  /** "HH:mm" inclusive. */
  start?: string | null;
  /** "HH:mm" exclusive. */
  end?: string | null;
}

export interface DispatchMessage {
  id: string;
  body: string | null;
  direction: string;
  created_at: string;
}

export interface DispatchConversation {
  id: string;
  is_group: boolean | null;
  group_chat_id: string | null;
}

export interface TriggerMatchInput {
  config: TriggerConfig;
  message: DispatchMessage;
  conversation: DispatchConversation;
  /** Override clock (tests). Defaults to `new Date()`. */
  now?: Date;
}

const DEFAULT_DAYS = ["mon", "tue", "wed", "thu", "fri"];
const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function triggerMatches(input: TriggerMatchInput): boolean {
  const { config, message, conversation } = input;
  const now = input.now ?? new Date();

  // 1. Event type — accept "message" and "message.any" as the inbound trigger.
  const events = Array.isArray(config.events) ? config.events : [];
  const wantsMessage = events.includes("message") || events.includes("message.any");
  if (!wantsMessage) return false;

  const filters = config.filters ?? {};

  // 2. Group filter — defaults to ignoring groups when flag absent (spec default).
  const ignoreGroups = filters.ignore_groups !== false;
  const isGroup = Boolean(conversation.is_group) || Boolean(conversation.group_chat_id);
  if (ignoreGroups && isGroup) return false;

  // 3. Self filter — defaults to ignoring fromMe (mirrors WAHA worker default).
  const ignoreSelf = filters.ignore_self !== false;
  if (ignoreSelf && message.direction === "outbound") return false;

  // 4. Keyword regex — case-insensitive match against the inbound body.
  if (filters.keyword_regex) {
    let re: RegExp;
    try {
      re = new RegExp(filters.keyword_regex, "i");
    } catch {
      // Malformed regex never matches — caller-side validation catches this on save.
      return false;
    }
    if (!re.test(message.body ?? "")) return false;
  }

  // 5. Business hours — optional. If configured, message must fall inside window.
  if (filters.business_hours) {
    if (!inBusinessHours(filters.business_hours, now)) return false;
  }

  return true;
}

function inBusinessHours(cfg: BusinessHoursConfig, ts: Date): boolean {
  const tz = cfg.tz ?? "UTC";
  const dayAbbrev = weekdayAbbrev(ts, tz);
  const days = cfg.days && cfg.days.length > 0 ? cfg.days.map((d) => d.toLowerCase()) : DEFAULT_DAYS;
  if (!days.includes(dayAbbrev)) return false;

  if (!cfg.start || !cfg.end) return true;
  const minutes = minutesOfDay(ts, tz);
  const startMin = parseHM(cfg.start);
  const endMin = parseHM(cfg.end);
  if (startMin === null || endMin === null) return true;
  if (startMin <= endMin) {
    return minutes >= startMin && minutes < endMin;
  }
  return minutes >= startMin || minutes < endMin;
}

function weekdayAbbrev(ts: Date, tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    return formatter.format(ts).slice(0, 3).toLowerCase();
  } catch {
    return Object.keys(DAY_INDEX)[ts.getUTCDay()] ?? "mon";
  }
}

function minutesOfDay(ts: Date, tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const [hh, mm] = formatter.format(ts).split(":");
    const h = Number(hh);
    const m = Number(mm);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  } catch {
    /* fall through */
  }
  return ts.getUTCHours() * 60 + ts.getUTCMinutes();
}

function parseHM(value: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!matched) return null;
  const h = Number(matched[1]);
  const min = Number(matched[2]);
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return h * 60 + min;
}
