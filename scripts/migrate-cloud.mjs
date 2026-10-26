import { migrateCloud } from './cloud-data.mjs';

console.log(await migrateCloud(process.argv[2] || '.local/data'));
