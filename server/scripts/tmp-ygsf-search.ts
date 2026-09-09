/** 一次性：以观源站搜索兰亭相关字帖（找神龙本） */
import { loadYgsfToken, searchZuopin } from '../services/ygsf.js';

const token = loadYgsfToken();
const r = await searchZuopin('兰亭', token);
console.log('total:', r.total);
for (const i of r.items) {
  if (i.name.includes('兰亭')) console.log(`${i.zuopinId} | ${i.name} | ${i.author} | zitie=${i.zitieId}`);
}
process.exit(0);
