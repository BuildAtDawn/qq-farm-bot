const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const repo = path.resolve(__dirname, '../..');

async function fixture(t) {
  // 在独立目录使用假服务和假构建命令，不加载真实账号或连接农场服务。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq farm 启停 '));
  for (const directory of ['scripts', 'core/node_modules', 'web/node_modules', 'bin']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  for (const file of ['start.sh', 'stop.sh', 'scripts/local-service-common.sh']) fs.copyFileSync(path.join(repo, file), path.join(root, file));
  fs.writeFileSync(path.join(root, 'bin/npm'), '#!/bin/sh\nprintf "mock build\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'core/client.js'), `
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(__dirname, 'child.pid'), String(worker.pid));
console.log('fixture ready');
http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); }).listen(Number(process.env.ADMIN_PORT));
`);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const pidFile = path.join(root, 'core/data/local-start.pid');
  const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${path.dirname(process.execPath)}:${process.env.PATH}`, ADMIN_PORT: String(port) };
  const run = (file, overrides = {}) => exec('bash', [path.join(root, file)], { cwd: os.tmpdir(), env: { ...env, ...overrides }, timeout: 35000 });
  t.after(async () => {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, 'utf8').split('\n')[0]);
      if (pid > 0 && pid !== process.pid) {
        try { process.kill(-pid, 'SIGKILL'); } catch {}
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, port, pidFile, run };
}

test('后台启动、重复启动、子进程停止及重复停止；支持空格中文路径和其他工作目录', async (t) => {
  const f = await fixture(t);
  assert.match((await f.run('start.sh')).stdout, /服务已启动/);
  const record = fs.readFileSync(f.pidFile, 'utf8');
  const pid = Number(record.split('\n')[0]);
  const child = Number(fs.readFileSync(path.join(f.root, 'core/child.pid'), 'utf8'));
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.doesNotThrow(() => process.kill(child, 0));
  const duplicate = await f.run('start.sh');
  assert.match(duplicate.stdout, /已在运行/);
  assert.doesNotMatch(duplicate.stdout, /mock build/);
  assert.equal(fs.readFileSync(f.pidFile, 'utf8'), record);
  assert.match((await f.run('stop.sh')).stdout, /服务已停止/);
  assert.equal(fs.existsSync(f.pidFile), false);
  assert.throws(() => process.kill(pid, 0));
  assert.throws(() => process.kill(child, 0));
  assert.match((await f.run('stop.sh')).stdout, /未运行/);
  assert.match(fs.readFileSync(path.join(f.root, 'core/data/local-service.log'), 'utf8'), /fixture ready/);
});

test('端口被其他服务占用时拒绝启动，保留其他服务', async (t) => {
  const f = await fixture(t);
  const server = net.createServer();
  await new Promise(resolve => server.listen(f.port, '0.0.0.0', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(f.run('start.sh'), error => /已被占用/.test(error.stderr));
  assert.equal(server.listening, true);
  assert.equal(fs.existsSync(f.pidFile), false);
});

test('PID 记录被误写时拒绝停止无关进程', async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.dirname(f.pidFile), { recursive: true });
  fs.writeFileSync(f.pidFile, `${process.pid}\nincorrect start time\n${f.port}\n`);
  await assert.rejects(f.run('stop.sh'), error => /不匹配/.test(error.stderr));
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('前端构建失败不启动后台进程', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'bin/npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(f.run('start.sh'));
  assert.equal(fs.existsSync(f.pidFile), false);
  assert.equal(fs.existsSync(path.join(f.root, 'core/child.pid')), false);
});

test('非法端口在启动前返回明确错误', async (t) => {
  const f = await fixture(t);
  for (const port of ['0', '65536', 'abc']) {
    await assert.rejects(f.run('start.sh', { ADMIN_PORT: port }), error => /ADMIN_PORT/.test(error.stderr));
  }
});
