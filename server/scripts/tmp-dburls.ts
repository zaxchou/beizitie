import { getDb, waitForDb } from '../db.js';
await waitForDb();
const db = getDb();
const deck = (await db.query("SELECT id FROM decks WHERE source_key='ygsf:c4fe6f21ab5ccdd8b160705baef65e56'")).rows[0];
const r = await db.query('SELECT front_text, image_url FROM cards WHERE deck_id=$1 LIMIT 3', [deck.id]);
for (const row of r.rows) console.log(row.front_text, '|', row.image_url);
process.exit(0);
