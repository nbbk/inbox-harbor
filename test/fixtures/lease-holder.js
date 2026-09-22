const { acquireInstanceLock } = require('../../instance-lock');
const lock = acquireInstanceLock(process.argv[2], { staleMs: Number(process.argv[3]), updateMs: Number(process.argv[4]) });
process.stdout.write('ready\n');
const until = Date.now() + Number(process.argv[5]);
while (Date.now() < until) Math.sqrt(1234567);
lock.release();
