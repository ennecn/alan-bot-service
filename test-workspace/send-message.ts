/**
 * Send a test message to a running Alan Engine instance.
 *
 * Usage: npx tsx test-workspace/send-message.ts ["your message here"]
 */

const message = process.argv[2] || '你好呀！你在弹什么歌？';
const baseUrl = process.env.ALAN_URL || 'http://localhost:7088';

async function main() {
  console.log(`[test] Sending: "${message}"`);
  console.log(`[test] Target: ${baseUrl}/v1/messages`);
  console.log('---');

  const start = Date.now();
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'alan',
      max_tokens: 2000,
      stream: false,
      messages: [{ role: 'user', content: message }],
    }),
  });

  const latency = Date.now() - start;

  if (!response.ok) {
    const text = await response.text();
    console.error(`[test] HTTP ${response.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const replyText = data.content
    ?.filter(b => b.type === 'text')
    .map(b => b.text)
    .join('') ?? '(no text)';

  console.log(`[reply] ${replyText}`);
  console.log('---');
  console.log(`[metrics] latency=${latency}ms, model=${data.model}, stop=${data.stop_reason}`);
  if (data.usage) {
    console.log(`[metrics] tokens: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);
  }
}

main().catch(err => {
  console.error('[test] Error:', err);
  process.exit(1);
});
