/* RTF — live team statistics from FTCScout (https://ftcscout.org).
 * GraphQL API: https://api.ftcscout.org/graphql (public, CORS-enabled).
 *
 * One request fills the whole page:
 *   past    = team #20092 (seasons 2022–2025): awards + quickStats + 2025 matches
 *   current = team #37548 (season 2026):       awards + quickStats + 2026 matches
 *
 * Renders:
 *   Hero facts:
 *     best OPR world rank all-time + its season
 *     current-season rank (when FTCScout has data)
 *     latest played season's match win rate
 *     (award/inspire counts are static hand-counted values in the HTML)
 *   Stat cards ([data-rtf-stat-cards]):
 *     OPR headline + "#rank / percentile%" badge, best-season star note
 *   Every [data-rtf-stats="<season>"] block: values, ranks (percent after /),
 *     headline, team line, FTCScout link, empty state.
 *   Season cards:
 *     every [data-rtf-stats="<season>"] block is filled; all seasons are on
 *     the single-page site, with no separate seasons page.
 */
(function () {
  "use strict";

  var API = "https://api.ftcscout.org/graphql";
  var PAST_TEAM = 20092;
  var CURRENT_TEAM = 37548;
  var CURRENT_SEASON = 2026;
  var PAST_SEASONS = [2025, 2024, 2023, 2022];
  var GAMES = {
    2022: "Power Play",
    2023: "Center Stage",
    2024: "Into the Deep",
    2025: "Decode",
    2026: ""
  };

  var QUERY = [
    "{",
    "  past: teamByNumber(number: 20092) {",
    "    s2025: quickStats(season: 2025) { season count tot { value rank } auto { value rank } dc { value rank } eg { value rank } }",
    "    s2024: quickStats(season: 2024) { season count tot { value rank } auto { value rank } dc { value rank } eg { value rank } }",
    "    s2023: quickStats(season: 2023) { season count tot { value rank } auto { value rank } dc { value rank } eg { value rank } }",
    "    s2022: quickStats(season: 2022) { season count tot { value rank } auto { value rank } dc { value rank } eg { value rank } }",
    "    m2025: matches(season: 2025) {",
    "      alliance match { id hasBeenPlayed tournamentLevel series matchNum",
    "        scores { ...on MatchScores2025 { red { totalPointsNp } blue { totalPointsNp } } }",
    "      }",
    "    }",
    "  }",
    "  current: teamByNumber(number: 37548) {",
    "    s2026: quickStats(season: 2026) { season count tot { value rank } auto { value rank } dc { value rank } eg { value rank } }",
    "    m2026: matches(season: 2026) {",
    "      alliance match { id hasBeenPlayed",
    "        scores { ...on MatchScores2026 { red { totalPointsNp } blue { totalPointsNp } } }",
    "      }",
    "    }",
    "  }",
    "}"
  ].join("\n");

  /* ---------- fetching ---------- */

  function gql() {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;

    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        if (json.errors) throw new Error(json.errors[0].message);
        return json.data || null;
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return null;
      });
  }

  /* ---------- formatting ---------- */

  function fmt(value) {
    return typeof value === "number" ? value.toFixed(2) : "—";
  }

  function fmtInt(n) {
    return typeof n === "number" ? n.toLocaleString("en-US") : "—";
  }

  function pctOf(rank, count) {
    if (rank == null || !count) return null;
    return (rank / count * 100).toFixed(1);
  }

  /* "#276 / 3.3%" — rank, then percentile instead of the raw team count */
  function fmtRank(cell, count) {
    if (!cell || cell.rank == null) return "—";
    var pct = pctOf(cell.rank, count);
    var s = "#" + cell.rank.toLocaleString("en-US");
    if (pct != null) s += " / " + pct + "%";
    return s;
  }

  function winrateOf(parts) {
    var w = 0, l = 0;
    (parts || []).forEach(function (part) {
      var m = part.match;
      if (!m || !m.hasBeenPlayed || !m.scores) return;
      var mine = part.alliance === "Red" ? m.scores.red : m.scores.blue;
      var opp = part.alliance === "Red" ? m.scores.blue : m.scores.red;
      if (!mine || !opp) return;
      if (mine.totalPointsNp > opp.totalPointsNp) w++;
      else if (mine.totalPointsNp < opp.totalPointsNp) l++;
    });
    return (w + l) > 0 ? (w / (w + l) * 100) : null;
  }

  /* ---------- model ---------- */

  function buildModel(data) {
    if (!data) return null;
    var p = data.past || {};
    var c = data.current || {};

    var quick = {};
    quick[CURRENT_SEASON] = c.s2026 || null;
    PAST_SEASONS.forEach(function (s, i) {
      quick[s] = [p.s2025, p.s2024, p.s2023, p.s2022][i] || null;
    });

    var matches = {};
    matches[CURRENT_SEASON] = c.m2026 || [];
    matches[2025] = p.m2025 || [];

    var best = null;
    [CURRENT_SEASON].concat(PAST_SEASONS).forEach(function (s) {
      var q = quick[s];
      if (q && q.tot && (!best || q.tot.rank < best.qs.tot.rank)) {
        best = { season: s, qs: q };
      }
    });

    // latest win rate: current season first, else the newest season with matches
    var winSeason = null;
    if ((matches[CURRENT_SEASON] || []).length) winSeason = CURRENT_SEASON;
    else if ((matches[2025] || []).length) winSeason = 2025;

    return {
      quick: quick,
      matches: matches,
      best: best,
      currentQuick: quick[CURRENT_SEASON],
      winSeason: winSeason,
      winrate: winSeason ? winrateOf(matches[winSeason]) : null
    };
  }

  /* ---------- rendering ---------- */

  function setText(sel, value) {
    var el = document.querySelector(sel);
    if (el) el.textContent = value;
  }

  function renderHero(m) {
    setText("[data-rtf-best-rank]", m.best ? "#" + fmtInt(m.best.qs.tot.rank) : "—");
    setText("[data-rtf-best-rank-season]", m.best ? String(m.best.season) : "—");
    setText("[data-rtf-current-rank]", m.currentQuick && m.currentQuick.tot
      ? "#" + fmtInt(m.currentQuick.tot.rank) : "—");
    setText("[data-rtf-current-rank-season]", String(CURRENT_SEASON));
    var winText = m.winrate != null ? m.winrate.toFixed(1) + "%" : "—";
    setText("[data-rtf-winrate]", winText);
    setText("[data-rtf-winrate-live]", winText);
  }

  /* stat card headline: OPR value + "#rank / percentile%" badge */
  function renderCardHead(block, qs) {
    var opr = block.querySelector("[data-rtf-opr-number]");
    if (opr) opr.textContent = qs ? fmt(qs.tot && qs.tot.value) : "—";
    var badge = block.querySelector("[data-rtf-rank-percent]");
    if (badge) {
      if (qs && qs.tot) {
        var pct = pctOf(qs.tot.rank, qs.count);
        badge.textContent = qs.tot.rank.toLocaleString("en-US") + (pct != null ? " / " + pct + "%" : "");
      } else {
        badge.textContent = "—";
      }
    }
  }

  function renderBestNote(m) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-rtf-best-note]"), function (el) {
      el.textContent = "";
    });
    if (!m.best) return;
    var text = "★ Best season · " + m.best.season + " · OPR #" +
      m.best.qs.tot.rank.toLocaleString("en-US");
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-rtf-stats="' + m.best.season + '"] [data-rtf-best-note]'),
      function (el) { el.textContent = text; }
    );
  }

  /* fill one [data-rtf-stats] season block from the model */
  function fillBlock(block, m) {
    var season = parseInt(block.getAttribute("data-rtf-stats"), 10);
    var team = season >= CURRENT_SEASON ? CURRENT_TEAM : PAST_TEAM;
    var qs = m.quick[season] || null;
    var game = GAMES[season] || "";

    ["tot", "auto", "dc", "eg"].forEach(function (k) {
      var v = block.querySelector('[data-stat="' + k + '"]');
      var r = block.querySelector('[data-stat-rank="' + k + '"]');
      if (v) v.textContent = qs ? fmt(qs[k] && qs[k].value) : "—";
      if (r) r.textContent = qs ? fmtRank(qs[k], qs.count) : "—";
    });

    var title = block.querySelector("[data-rtf-stats-title]");
    if (title) title.textContent = "Season " + season + (game ? " · " + game : "");

    var teamLine = block.querySelector("[data-rtf-stats-team]");
    if (teamLine) teamLine.textContent = "Team #" + team + " · FTCScout";

    Array.prototype.forEach.call(block.querySelectorAll("[data-rtf-stats-link]"), function (link) {
      link.href = "https://ftcscout.org/teams/" + team + "?season=" + season;
    });

    renderCardHead(block, qs);

    var note = block.querySelector("[data-rtf-stats-note]");
    if (note && !qs) {
      note.textContent = "No match data yet — the season has not started with events";
    }

    block.setAttribute("data-rtf-stats-live", "1");
  }

  function fillArchive(block, m, season) {
    var qs = m.quick[season] || null;
    var team = season >= CURRENT_SEASON ? CURRENT_TEAM : PAST_TEAM;

    var title = block.querySelector("[data-rtf-year-title]");
    if (title) title.textContent = "Season " + season + (GAMES[season] ? " · " + GAMES[season] : "");

    var teamLine = block.querySelector("[data-rtf-year-team]");
    if (teamLine) teamLine.textContent = "Team #" + team + " · FTCScout";

    ["tot", "auto", "dc", "eg"].forEach(function (k) {
      var v = block.querySelector('[data-stat="' + k + '"]');
      var r = block.querySelector('[data-stat-rank="' + k + '"]');
      if (v) v.textContent = qs ? fmt(qs[k] && qs[k].value) : "—";
      if (r) r.textContent = qs ? fmtRank(qs[k], qs.count) : "—";
    });

    var link = block.querySelector("[data-rtf-year-link]");
    if (link) link.href = "https://ftcscout.org/teams/" + team + "?season=" + season;
  }

  function markUnavailable() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-rtf-stats]"), function (block) {
      if (block.getAttribute("data-rtf-stats-live") === "1") return;
      var note = block.querySelector("[data-rtf-stats-note]");
      if (note) note.textContent = "Live update unavailable — showing last known values";
    });
  }

  /* ---------- tabs ---------- */

  function wireTabs(m) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".year-tabs button"));
    if (!tabs.length) return;

    var archive = document.getElementById("year-archive");

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (b) { b.setAttribute("aria-selected", String(b === t)); });
        var year = parseInt(t.getAttribute("data-year-tab"), 10);

        if (archive) {
          fillArchive(archive, m, year);
        } else {
          /* seasons page: tabs show one past card at a time (2026 always visible) */
          Array.prototype.forEach.call(
            document.querySelectorAll("[data-rtf-stats]"),
            function (block) {
              var s = parseInt(block.getAttribute("data-rtf-stats"), 10);
              if (s === CURRENT_SEASON) return;
              block.hidden = s !== year;
            }
          );
        }
      });
    });

    /* initial state: first tab's season */
    var initial = parseInt(tabs[0].getAttribute("data-year-tab"), 10);
    if (archive) fillArchive(archive, m, initial);
    else {
      Array.prototype.forEach.call(
        document.querySelectorAll("[data-rtf-stats]"),
        function (block) {
          var s = parseInt(block.getAttribute("data-rtf-stats"), 10);
          if (s === CURRENT_SEASON) return;
          block.hidden = s !== initial;
        }
      );
    }
  }

  /* ---------- init ---------- */

  var MODEL = null;

  /* Re-render everything live (used on init and after a language toggle,
   * which rewrites innerHTML of [data-i18n] nodes). */
  function renderAll() {
    if (!MODEL) return;
    renderHero(MODEL);
    Array.prototype.forEach.call(document.querySelectorAll("[data-rtf-stats]"), function (block) {
      fillBlock(block, MODEL);
    });
    renderBestNote(MODEL);

    var archive = document.getElementById("year-archive");
    if (archive) {
      var sel = document.querySelector('.year-tabs button[aria-selected="true"]');
      var year = sel ? parseInt(sel.getAttribute("data-year-tab"), 10) : 2025;
      fillArchive(archive, MODEL, year);
    }
  }

  document.addEventListener("rtf:refresh", renderAll);

  function init() {
    gql().then(function (data) {
      var m = buildModel(data);
      if (!m) {
        markUnavailable();
        return;
      }
      MODEL = m;
      renderAll();
      wireTabs(m);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
