const path=require('path');
const {Storage}=require('../storage');
const {backup,restoreBackup,recoverInterruptedRestore}=require('../migration-service');
const {acquireInstanceLock,dataDirectory}=require('../instance-lock');
const directory=dataDirectory(path.resolve(process.env.DATA_DIR||path.join(__dirname,'..')));
const args=process.argv.slice(2),restoreIndex=args.indexOf('--restore');
const lock=acquireInstanceLock(directory);
try{recoverInterruptedRestore(directory);if(restoreIndex>=0){const target=args[restoreIndex+1];if(!target)throw new Error('用法：npm run backup -- --restore <DATA_DIR 内的备份目录>');const resolved=path.isAbsolute(target)?target:path.resolve(directory,target);console.log(JSON.stringify(restoreBackup(directory,resolved),null,2));}else{const storage=new Storage(directory);try{console.log(JSON.stringify(backup(directory,storage),null,2));}finally{storage.close();}}}finally{lock.release();}
