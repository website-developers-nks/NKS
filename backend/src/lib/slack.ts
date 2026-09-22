const BOT_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]+$/;
const POST_TIMEOUT_MS = 5_000;
const CHAT_POST_MESSAGE = 'https://slack.com/api/chat.postMessage';

export interface SlackTarget {
  botToken: string;
  channelId: string;
}

export function isBotToken(token: string): boolean {
  return BOT_TOKEN_PATTERN.test((token ?? '').trim());
}

export function defaultBotToken(): string | null {
  const token = (process.env.DEFAULT_BOT_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? '').trim();
  return isBotToken(token) ? token : null;
}

export function hasDefaultBot(): boolean {
  return defaultBotToken() !== null;
}

export interface BotIdentity {
  name: string;
  team: string;
}

export async function describeBot(token: string): Promise<BotIdentity> {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.trim()}` },
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });

  const payload = await res.json().catch(() => ({})) as { ok?: boolean; user?: string; team?: string; error?: string };
  if (!payload.ok) throw new Error(botError(payload.error) ?? `Slack returned HTTP ${res.status}.`);

  return { name: payload.user ?? 'bot', team: payload.team ?? '' };
}

export interface SlackField {
  label: string;
  value: string;
}

export interface SlackMessage {
  title: string;
  emoji?: string;
  summary?: string;
  fields?: SlackField[];
  context?: string;
  link?: { label: string; url: string };
  compact?: boolean;
}

export interface SlackPostResult {
  ts: string | null;
}

function truncate(value: string, max: number): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildBlocks(message: SlackMessage): unknown[] {
  const blocks: unknown[] = [];

  if (message.compact) {
    const heading = `${message.emoji ? message.emoji + '  ' : ''}${message.title}`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: heading } });
  } else {
    blocks.push({ type: 'header', text: { type: 'plain_text', text: truncate(message.title, 150), emoji: true } });
    if (message.emoji || message.summary) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${message.emoji ?? ''} ${message.summary ?? ''}`.trim() },
      });
    }
  }

  const fields = (message.fields ?? []).filter((f) => f.value);
  for (let i = 0; i < fields.length; i += 10) {
    blocks.push({
      type: 'section',
      fields: fields.slice(i, i + 10).map((f) => ({
        type: 'mrkdwn',
        text: `*${f.label}*\n${truncate(f.value, 1800)}`,
      })),
    });
  }

  if (message.link) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: truncate(message.link.label, 75), emoji: true },
        url: message.link.url,
      }],
    });
  }

  if (message.context) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: truncate(message.context, 300) }] });
  }

  return blocks;
}

function fallbackText(message: SlackMessage): string {
  const parts = [message.title.replace(/\*/g, '')];
  if (message.summary) parts.push(message.summary);
  return truncate(parts.join(' — '), 300);
}

export async function postToSlack(
  target: SlackTarget,
  message: SlackMessage,
  threadTs?: string,
): Promise<SlackPostResult> {
  if (!isBotToken(target.botToken)) throw new Error('That is not a Slack bot token (xoxb-...).');
  if (!target.channelId?.trim()) throw new Error('A channel is required.');

  const res = await fetch(CHAT_POST_MESSAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${target.botToken.trim()}`,
    },
    body: JSON.stringify({
      channel: target.channelId.trim(),
      text: fallbackText(message),
      blocks: buildBlocks(message),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });

  const payload = await res.json().catch(() => ({})) as { ok?: boolean; ts?: string; error?: string };
  if (!payload.ok) throw new Error(botError(payload.error) ?? `Slack returned HTTP ${res.status}.`);

  return { ts: payload.ts ?? null };
}

function botError(code?: string): string | null {
  if (!code) return null;
  const known: Record<string, string> = {
    invalid_auth: 'Slack rejected the bot token.',
    account_inactive: 'That bot token belongs to a deactivated app.',
    channel_not_found: 'That channel does not exist, or the bot cannot see it. Check if bot is in channel',
    not_in_channel: 'The bot is not in that channel - invite it, or add the chat:write.public scope.',
    missing_scope: 'The bot token is missing the chat:write scope.',
    is_archived: 'That channel is archived.',
    msg_too_long: 'The message was too long for Slack.',
    rate_limited: 'Slack is rate limiting us - it will be retried on the next event.',
  };
  return known[code] ?? `Slack said "${code}".`;
}
