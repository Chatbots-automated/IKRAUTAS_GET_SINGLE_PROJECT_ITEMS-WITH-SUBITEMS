// /api/monday-items-with-subitems.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Use GET" });
    }

    const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
    if (!MONDAY_TOKEN) {
      return res.status(500).json({ error: "Missing env MONDAY_TOKEN" });
    }

    // boardId can come from env or query (?boardId=123)
    const boardId = String(req.query.boardId ?? process.env.MONDAY_BOARD_ID ?? "").trim();
    if (!boardId) {
      return res.status(400).json({ error: "Missing boardId (set MONDAY_BOARD_ID or pass ?boardId=...)" });
    }

    // default: return only items that have subitems
    const onlyWithSubitems = String(req.query.onlyWithSubitems ?? "true").toLowerCase() !== "false";

    // limits: monday supports up to 500 for next_items_page
    const limit = Math.min(
      Math.max(Number(req.query.limit ?? 200) || 200, 1),
      500
    );

    const endpoint = "https://api.monday.com/v2";

    const postMonday = async ({ query, variables }) => {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MONDAY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Monday returned non-JSON: ${text.slice(0, 300)}`);
      }

      if (!r.ok || json?.errors?.length) {
        const details = json?.errors?.map((e) => e?.message).filter(Boolean).join(" | ");
        throw new Error(`Monday API error (${r.status}): ${details || text.slice(0, 300)}`);
      }

      return json;
    };

    // Queries
    const Q_FIRST = `
      query ($boardId: ID!, $limit: Int!) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit) {
            cursor
            items {
              id
              name
              group { id title }
              column_values { id text value }
              subitems {
                id
                name
                column_values { id text value }
              }
            }
          }
        }
      }
    `;

    const Q_NEXT = `
      query ($cursor: String!, $limit: Int!) {
        next_items_page(cursor: $cursor, limit: $limit) {
          cursor
          items {
            id
            name
            group { id title }
            column_values { id text value }
            subitems {
              id
              name
              column_values { id text value }
            }
          }
        }
      }
    `;

    const all = [];
    let cursor = null;

    // --- first page ---
    {
      const first = await postMonday({
        query: Q_FIRST,
        variables: { boardId, limit },
      });

      const page = first?.data?.boards?.[0]?.items_page;
      cursor = page?.cursor ?? null;

      const items = Array.isArray(page?.items) ? page.items : [];
      for (const it of items) {
        if (!onlyWithSubitems || (Array.isArray(it.subitems) && it.subitems.length > 0)) {
          all.push(it);
        }
      }
    }

    // --- next pages ---
    while (cursor) {
      const next = await postMonday({
        query: Q_NEXT,
        variables: { cursor, limit },
      });

      const page = next?.data?.next_items_page;
      cursor = page?.cursor ?? null;

      const items = Array.isArray(page?.items) ? page.items : [];
      for (const it of items) {
        if (!onlyWithSubitems || (Array.isArray(it.subitems) && it.subitems.length > 0)) {
          all.push(it);
        }
      }
    }

    return res.status(200).json({
      boardId,
      limit,
      onlyWithSubitems,
      count: all.length,
      items: all,
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Unknown error",
    });
  }
}
