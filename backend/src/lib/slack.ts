
const WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;

const POST_TIMEOUT_MS = 3_000;

export function isWebhookUrl(url: string): boolean {
  return WEBHOOK_PATTERN.test((url ?? '').trim());
}

export interface SlackField {
  label: string;
  value: string;
}

export interface SlackMessage {
  text: string;
  emoji?: string;
  fields?: SlackField[];
  context?: string;
}

function buildBlocks(message: SlackMessage): unknown[] {
  const blocks: unknown[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${message.emoji ? message.emoji + ' ' : ''}*${message.text}*` },
    },
  ];

  const fields = (message.fields ?? []).filter((f) => f.value);
  if (fields.length) {
    blocks.push({
      type: 'section',
      fields: fields.slice(0, 10).map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })),
    });
  }

  if (message.context) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: message.context }] });
  }

  return blocks;
}

export async function postToSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
  if (!isWebhookUrl(webhookUrl)) throw new Error('That is not a Slack Incoming Webhook URL.');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message.text, blocks: buildBlocks(message) }),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });

  const body = await res.text().catch(() => '');
  if (!res.ok || body.trim() !== 'ok') {
    throw new Error(slackError(body) ?? `Slack returned HTTP ${res.status}.`);
  }
}

function slackError(body: string): string | null {
  const text = (body ?? '').trim();
  if (!text) return null;
  if (text === 'invalid_token' || text === 'no_service') {
    return 'Slack rejected the webhook - it may have been revoked or the app removed.';
  }
  if (text === 'channel_not_found') return 'The channel that webhook posts to no longer exists.';
  return `Slack said "${text}".`;
}
