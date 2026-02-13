const pty = require('node-pty');
try {
  console.log('Spawning node-pty...');
  const p = pty.spawn('/opt/homebrew/bin/node', [
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    '-p', 'say hi in one word',
    '--output-format', 'stream-json',
    '--verbose', '--max-turns', '1',
    '--dangerously-skip-permissions'
  ], {
    cwd: '/Users/fangjin/telegram-claude-bot/workspace',
    env: Object.assign({}, process.env, { HOME: '/Users/fangjin' }),
    cols: 200,
    rows: 50
  });
  console.log('Spawned PID:', p.pid);
  let out = '';
  p.onData(d => { out += d; });
  p.onExit(({exitCode}) => {
    console.log('EXIT:', exitCode);
    console.log('OUT_LAST_500:', out.slice(-500));
    process.exit(0);
  });
  setTimeout(() => {
    console.log('TIMEOUT, partial:', out.slice(0, 500));
    p.kill();
    process.exit(1);
  }, 25000);
} catch(e) {
  console.log('ERROR:', e.message);
  console.log('STACK:', e.stack);
}
