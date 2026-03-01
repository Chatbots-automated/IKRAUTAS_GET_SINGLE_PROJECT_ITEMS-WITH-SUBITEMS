export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    const token = process.env.MONDAY_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "Missing MONDAY_TOKEN env variable" });
    }

    const boardId = String(req.query.boardId || "1645436514");
    const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 500);

    const endpoint = "https://api.monday.com/v2";

    const FIRST_QUERY = `
      query ($boardId: ID!, $limit: Int!) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit) {
            cursor
            items {
              id
              name
              group {
                id
                title
              }
              column_values {
                id
                text
                value
              }
              subitems {
                id
                name
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      }
    `;

    const NEXT_QUERY = `
      query ($cursor: String!, $limit: Int!) {
        next_items_page(cursor: $cursor, limit: $limit) {
          cursor
          items {
            id
            name
            group {
              id
              title
            }
            column_values {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    async function postMonday(query, variables) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      const data = await response.json();

      if (!response.ok || data.errors) {
        return {
          ok: false,
          status: response.status,
          error: data,
        };
      }

      return {
        ok: true,
        data,
      };
    }

    const allItems = [];

    // 1st page
    const firstResult = await postMonday(FIRST_QUERY, {
      boardId,
      limit,
    });

    if (!firstResult.ok) {
      return res.status(500).json({
        error: "Monday first query failed",
        details: firstResult.error,
      });
    }

    let page = firstResult.data?.data?.boards?.[0]?.items_page;
    if (!page) {
      return res.status(500).json({
        error: "Missing items_page in first response",
        raw: firstResult.data,
      });
    }

    allItems.push(...(Array.isArray(page.items) ? page.items : []));

    let cursor = page.cursor ?? null;

    // next pages
    while (cursor) {
      const nextResult = await postMonday(NEXT_QUERY, {
        cursor,
        limit,
      });

      if (!nextResult.ok) {
        return res.status(500).json({
          error: "Monday next_items_page query failed",
          cursor,
          details: nextResult.error,
        });
      }

      page = nextResult.data?.data?.next_items_page;

      if (!page) {
        return res.status(500).json({
          error: "Missing next_items_page in paginated response",
          cursor,
          raw: nextResult.data,
        });
      }

      allItems.push(...(Array.isArray(page.items) ? page.items : []));
      cursor = page.cursor ?? null;
    }

    return res.status(200).json({
      success: true,
      boardId,
      limit,
      totalItems: allItems.length,
      items: allItems,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unhandled server error",
      message: error.message,
    });
  }
}
