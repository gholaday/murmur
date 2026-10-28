/** Episodes still to come in anyone's Up Next (after the item playing), for SQL that keeps or scans them first. */
export const WAITING_EPISODES_SQL = `SELECT json_extract(j.value, '$.itemId') AS id FROM up_next u, json_each(u.items) j
  WHERE json_extract(j.value, '$.itemType') = 'episode' AND j.key > u.idx`;
