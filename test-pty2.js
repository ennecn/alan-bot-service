const pty = require('node-pty');
// Test 1: simple echo
try {
  console.log('Test 1: /bin/echo');
  const p1 = pty.spawn('/bin/echo', ['hello'], { cols: 80, rows: 24 });
  p1.onData(d => process.stdout.write('T1: ' + d));
  p1.onExit(({exitCode}) => console.log('T1 exit:', exitCode));
} catch(e) {
  console.log('T1 ERROR:', e.message);
}

// Test 2: /bin/sh -c
setTimeout(() => {
  try {
    console.log('Test 2: /bin/sh -c');
    const p2 = pty.spawn('/bin/sh', ['-c', 'echo hello from sh'], { cols: 80, rows: 24 });
    p2.onData(d => process.stdout.write('T2: ' + d));
    p2.onExit(({exitCode}) => { console.log('T2 exit:', exitCode); });
  } catch(e) {
    console.log('T2 ERROR:', e.message);
  }
}, 1000);

// Test 3: node directly
setTimeout(() => {
  try {
    console.log('Test 3: /opt/homebrew/bin/node -e');
    const p3 = pty.spawn('/opt/homebrew/bin/node', ['-e', 'console.log("hello from node")'], { cols: 80, rows: 24 });
    p3.onData(d => process.stdout.write('T3: ' + d));
    p3.onExit(({exitCode}) => { console.log('T3 exit:', exitCode); process.exit(0); });
  } catch(e) {
    console.log('T3 ERROR:', e.message);
  }
}, 2000);

setTimeout(() => process.exit(0), 5000);
