(() => {
  const SUPABASE_URL = "https://qtlibnfilwacadecnqej.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_kpQHC4eiD7-FDKIjRqjDGg_PgKTkd-p";

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let page = 0;
  const pageSize = 50;

  const els = {
    searchName: document.getElementById("searchName"),
    positionFilter: document.getElementById("positionFilter"),
    minOverall: document.getElementById("minOverall"),
    maxOverall: document.getElementById("maxOverall"),
    minAge: document.getElementById("minAge"),
    maxAge: document.getElementById("maxAge"),
    minMatches: document.getElementById("minMatches"),
    sortBy: document.getElementById("sortBy"),
    applyFilters: document.getElementById("applyFilters"),
    playersBody: document.getElementById("playersBody"),
    status: document.getElementById("status"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageInfo: document.getElementById("pageInfo"),
  };

  function valueOrNull(input) {
    const value = input.value.trim();
    return value === "" ? null : value;
  }

  function numberOrNull(input) {
    const value = input.value.trim();
    return value === "" ? null : Number(value);
  }

  function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined) return "-";
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(decimals);
  }

  function formatPositions(positions) {
    if (!positions) return "-";
    if (Array.isArray(positions)) return positions.join(", ");
    return String(positions);
  }

  async function loadPlayers() {
    els.status.textContent = "Loading...";

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const sortBy = els.sortBy.value || "rating_per_90";

    let query = db
      .from("mfl_moneyball_player_view")
      .select("*", { count: "exact" })
      .range(from, to)
      .order(sortBy, { ascending: false, nullsFirst: false });

    const name = valueOrNull(els.searchName);
    const position = valueOrNull(els.positionFilter);
    const minOverall = numberOrNull(els.minOverall);
    const maxOverall = numberOrNull(els.maxOverall);
    const minAge = numberOrNull(els.minAge);
    const maxAge = numberOrNull(els.maxAge);
    const minMatches = numberOrNull(els.minMatches);

    if (name) query = query.ilike("full_name", `%${name}%`);
    if (position) query = query.contains("positions", [position]);
    if (minOverall !== null) query = query.gte("overall", minOverall);
    if (maxOverall !== null) query = query.lte("overall", maxOverall);
    if (minAge !== null) query = query.gte("age", minAge);
    if (maxAge !== null) query = query.lte("age", maxAge);
    if (minMatches !== null) query = query.gte("matches", minMatches);

    const { data, error, count } = await query;

    if (error) {
      console.error(error);
      els.status.textContent = `Error: ${error.message}`;
      return;
    }

    renderPlayers(data || []);
    els.status.textContent = `${count || 0} matching players`;
    els.pageInfo.textContent = `Page ${page + 1}`;
    els.prevPage.disabled = page === 0;
    els.nextPage.disabled = to + 1 >= (count || 0);
  }

  function renderPlayers(players) {
    els.playersBody.innerHTML = "";

    if (!players.length) {
      els.playersBody.innerHTML = `
        <tr>
          <td colspan="13" class="empty">No players found.</td>
        </tr>
      `;
      return;
    }

    for (const p of players) {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>
          <strong>${p.full_name || "-"}</strong>
          <div class="sub">ID: ${p.player_id}</div>
        </td>
        <td>${formatPositions(p.positions)}</td>
        <td>${p.age ?? "-"}</td>
        <td>${p.overall ?? "-"}</td>
        <td>
          ${p.club_name || "-"}
          <div class="sub">${p.owner_name || ""}</div>
        </td>
        <td>${p.matches ?? "-"}</td>
        <td>${p.minutes ?? "-"}</td>
        <td>${formatNumber(p.goals_per_90)}</td>
        <td>${formatNumber(p.assists_per_90)}</td>
        <td>${formatNumber(p.chances_created_per_90)}</td>
        <td>${formatNumber(p.dribbles_per_90)}</td>
        <td>${formatNumber(p.defensive_duels_won_per_90)}</td>
        <td>${formatNumber(p.rating_per_90)}</td>
      `;

      els.playersBody.appendChild(tr);
    }
  }

  els.applyFilters.addEventListener("click", () => {
    page = 0;
    loadPlayers();
  });

  els.prevPage.addEventListener("click", () => {
    if (page > 0) {
      page -= 1;
      loadPlayers();
    }
  });

  els.nextPage.addEventListener("click", () => {
    page += 1;
    loadPlayers();
  });

  [
    els.searchName,
    els.positionFilter,
    els.minOverall,
    els.maxOverall,
    els.minAge,
    els.maxAge,
    els.minMatches,
    els.sortBy,
  ].forEach((el) => {
    el.addEventListener("change", () => {
      page = 0;
      loadPlayers();
    });
  });

  els.searchName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      page = 0;
      loadPlayers();
    }
  });

  loadPlayers();
})();
