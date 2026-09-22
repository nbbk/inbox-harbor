const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const control = new Int32Array(workerData.control);
let stopped = false;
function finish() { if (stopped) return; stopped = true; Atomics.store(control, 1, 1); Atomics.notify(control, 1); parentPort.close(); }
function heartbeat() {
  if (Atomics.load(control, 0) === 1) return finish();
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(workerData.leasePath, 'owner.json'), 'utf8'));
    if (!owner || owner.token !== workerData.token) { parentPort.postMessage({ type: 'lost', error: '实例锁租约已被其他进程接管' }); return finish(); }
    fs.utimesSync(workerData.leasePath, new Date(), new Date());
  } catch (error) { parentPort.postMessage({ type: 'lost', error: error.message }); finish(); }
}
const timer = setInterval(heartbeat, workerData.updateMs); timer.unref?.();
parentPort.on('message', () => { if (Atomics.load(control, 0) === 1) { clearInterval(timer); finish(); } });
