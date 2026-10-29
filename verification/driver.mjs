// Verification helper, not part of the plugin. See VERIFICATION.md.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// Runs `sf org login remote` under `script` (gives sf a real pty). Writes the printed authorization URL to
// /work/auth_url.txt, waits for /work/callback.txt, feeds it into the hidden prompt, deletes it, records the result.
const args = process.argv.slice(2).join(' ');
const child = spawn('script', ['-q', '-e', '-c', `sf org login remote ${args}`, '/dev/null'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
let urlWritten = false;
let sent = false;
const onData = (d) => {
  out += d.toString();
  if (!urlWritten) {
    const line = out.split(/\r?\n/).find((l) => l.startsWith('https://'));
    if (line) {
      writeFileSync('/work/auth_url.txt', line.trim());
      urlWritten = true;
    }
  }
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
const timer = setInterval(() => {
  if (urlWritten && !sent && existsSync('/work/callback.txt')) {
    const cb = readFileSync('/work/callback.txt', 'utf8').trim();
    rmSync('/work/callback.txt');
    child.stdin.write(cb + '\r');
    sent = true;
  }
}, 1000);
child.on('exit', (code) => {
  clearInterval(timer);
  const clean = out
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() && !l.includes('input is masked') && !l.includes('toggle visibility'))
    .join('\n');
  writeFileSync('/work/result.txt', `${clean}\nEXIT ${code}\n`);
});
