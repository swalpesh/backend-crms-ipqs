// src/utils/id.generator.js
export async function nextId(conn, seqKey, prefix, pad = 3) {
  // Make sure the sequence row exists
  await conn.query(
    `INSERT INTO sequences (seq_key, last_num)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE seq_key = VALUES(seq_key)`,
    [seqKey]
  );

  // Lock the row, bump the counter
  const [[row]] = await conn.query(
    `SELECT last_num FROM sequences WHERE seq_key = ? FOR UPDATE`,
    [seqKey]
  );

  const next = Number(row.last_num) + 1;

  await conn.query(
    `UPDATE sequences SET last_num = ? WHERE seq_key = ?`,
    [next, seqKey]
  );

  return `${prefix}${String(next).padStart(pad, "0")}`; // e.g., company001 / doc001
}
