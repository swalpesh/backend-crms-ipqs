import { pool } from "../config/db.js";

const PREFIX = process.env.ID_PREFIX || "SUP-IPQS-";
const MIN_NUM = Number(process.env.ID_MIN || 100);

// Extract numeric suffix from ID string like "SUP-IPQS-123"
function extractNum(id) {
  const n = id?.slice(PREFIX.length);
  return Number(n || 0);
}

/**
 * Returns the next custom ID like SUP-IPQS-101
 * Uses SELECT ... FOR UPDATE inside a transaction to lock reads.
 */
export async function getNextSuperAdminId(conn) {
  const [rows] = await conn.query(
    `SELECT id FROM super_admins
     WHERE id LIKE CONCAT(?, '%')
     ORDER BY CAST(SUBSTRING(id, ?) AS UNSIGNED) DESC
     LIMIT 1 FOR UPDATE`,
    [PREFIX, PREFIX.length + 1]
  );

  const currentMax = rows.length ? extractNum(rows[0].id) : (MIN_NUM - 1);
  const nextNum = Math.max(currentMax + 1, MIN_NUM);
  return `${PREFIX}${nextNum}`;
}
