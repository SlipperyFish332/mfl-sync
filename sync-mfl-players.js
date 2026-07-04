require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MFL_API_BASE = 'https://z519wdyajg.execute-api.us-east-1.amazonaws.com/prod';

const BATCH_SIZE = Number(process.env.CAREER_BATCH_SIZE || 25);
const CONCURRENCY = Number(process.env.CAREER_CONCURRENCY || 1);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1000);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(value, decimals = 2) {
  return Number(toNumber(value).toFixed(decimals));
}

function isStopError(message) {
  return (
    message.includes('STOP_SYNC_403') ||
    message.includes('STOP_SYNC_429')
  );
}

async function withRetry(fn, label, maxRetries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (isStopError(err.message)) {
        throw err;
      }

      const waitMs = attempt * 1000;
      console.warn(`${label} failed attempt ${attempt}/${maxRetries}: ${err.message}`);

      if (attempt < maxRetries) {
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

async function fetchMissingPlayerIds() {
  const { data, error } = await supabase
    .from('mfl_players_missing_career_stats')
    .select('player_id')
    .order('player_id', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    throw new Error(`Failed to fetch missing player IDs: ${error.message}`);
  }

  return data.map(row => Number(row.player_id));
}

async function fetchPlayerCompetitions(playerId) {
  const url = `${MFL_API_BASE}/players/${playerId}/competitions`;

  const res = await fetch(url);

  if (res.status === 403) {
    throw new Error(`STOP_SYNC_403: MFL blocked or rate-limited requests at player ${playerId}`);
  }

  if (res.status === 429) {
    throw new Error(`STOP_SYNC_429: MFL rate limit hit at player ${playerId}`);
  }

  if (res.status === 404) {
    return [];
  }

  if (!res.ok) {
    throw new Error(`MFL API ${res.status} for player ${playerId}`);
  }

  const data = await res.json();

  return Array.isArray(data) ? data : [];
}

function buildCareerTotals(competitions) {
  const totals = {
    competitions_count: competitions.length,

    matches: 0,
    minutes: 0,
    wins: 0,
    draws: 0,
    losses: 0,

    goals: 0,
    assists: 0,
    xg: 0,

    shots: 0,
    shots_on_target: 0,
    shots_intercepted: 0,

    passes: 0,
    passes_accurate: 0,
    chances_created: 0,

    crosses: 0,
    crosses_accurate: 0,

    dribbling_success: 0,
    dribbled_past: 0,

    clearances: 0,
    defensive_duels_won: 0,

    shots_interceptions: 0,

    fouls_committed: 0,
    fouls_suffered: 0,

    saves: 0,
    goals_conceded: 0,
    own_goals: 0,

    yellow_cards: 0,
    red_cards: 0,

    rating_raw: 0
  };

  for (const item of competitions) {
    const s = item.stats || {};

    totals.matches += toNumber(s.nbMatches);

    // MFL gives time in seconds. Your DB column is minutes.
    totals.minutes += Math.round(toNumber(s.time) / 60);

    totals.wins += toNumber(s.wins);
    totals.draws += toNumber(s.draws);
    totals.losses += toNumber(s.losses);

    totals.goals += toNumber(s.goals);
    totals.assists += toNumber(s.assists);
    totals.xg += toNumber(s.xG);

    totals.shots += toNumber(s.shots);
    totals.shots_on_target += toNumber(s.shotsOnTarget);
    totals.shots_intercepted += toNumber(s.shotsIntercepted);

    totals.passes += toNumber(s.passes);
    totals.passes_accurate += toNumber(s.passesAccurate);
    totals.chances_created += toNumber(s.chancesCreated);

    totals.crosses += toNumber(s.crosses);
    totals.crosses_accurate += toNumber(s.crossesAccurate);

    totals.dribbling_success += toNumber(s.dribblingSuccess);
    totals.dribbled_past += toNumber(s.dribbledPast);

    totals.clearances += toNumber(s.clearances);
    totals.defensive_duels_won += toNumber(s.defensiveDuelsWon);

    totals.shots_interceptions += toNumber(s.shotsInterceptions);

    totals.fouls_committed += toNumber(s.foulsCommitted);
    totals.fouls_suffered += toNumber(s.foulsSuffered);

    totals.saves += toNumber(s.saves);
    totals.goals_conceded += toNumber(s.goalsConceded);
    totals.own_goals += toNumber(s.ownGoals);

    totals.yellow_cards += toNumber(s.yellowCards);
    totals.red_cards += toNumber(s.redCards);

    totals.rating_raw += toNumber(s.rating);
  }

  totals.xg = round(totals.xg, 2);
  totals.rating_raw = round(totals.rating_raw, 2);

  return totals;
}

function buildRows(playerId, competitions) {
  const totals = buildCareerTotals(competitions);
  const now = new Date().toISOString();

  const rawRow = {
    player_id: playerId,
    competitions_count: totals.competitions_count,
    career_totals: totals,
    raw_competitions: competitions,
    updated_at: now
  };

  const statsRow = {
    player_id: playerId,
    competitions_count: totals.competitions_count,
    matches: totals.matches,
    minutes: totals.minutes,
    wins: totals.wins,
    draws: totals.draws,
    losses: totals.losses,
    goals: totals.goals,
    assists: totals.assists,
    xg: totals.xg,
    shots: totals.shots,
    shots_on_target: totals.shots_on_target,
    shots_intercepted: totals.shots_intercepted,
    passes: totals.passes,
    passes_accurate: totals.passes_accurate,
    chances_created: totals.chances_created,
    crosses: totals.crosses,
    crosses_accurate: totals.crosses_accurate,
    dribbling_success: totals.dribbling_success,
    dribbled_past: totals.dribbled_past,
    clearances: totals.clearances,
    defensive_duels_won: totals.defensive_duels_won,
    shots_interceptions: totals.shots_interceptions,
    fouls_committed: totals.fouls_committed,
    fouls_suffered: totals.fouls_suffered,
    saves: totals.saves,
    goals_conceded: totals.goals_conceded,
    own_goals: totals.own_goals,
    yellow_cards: totals.yellow_cards,
    red_cards: totals.red_cards,
    rating_raw: totals.rating_raw,
    updated_at: now
  };

  return { rawRow, statsRow };
}

async function processPlayer(playerId) {
  await sleep(REQUEST_DELAY_MS);

  const competitions = await withRetry(
    () => fetchPlayerCompetitions(playerId),
    `Player ${playerId}`
  );

  const { rawRow, statsRow } = buildRows(playerId, competitions);

  return {
    playerId,
    rawRow,
    statsRow
  };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];

      try {
        results[currentIndex] = await fn(item);
      } catch (err) {
        if (isStopError(err.message)) {
          throw err;
        }

        results[currentIndex] = {
          playerId: item,
          error: err.message
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

async function upsertRows(table, rows) {
  if (!rows.length) return;

  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'player_id' });

  if (error) {
    throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function saveFailures(failed) {
  if (!failed.length) return;

  const failureRows = failed.map(fail => ({
    player_id: fail.playerId,
    error_message: fail.error,
    failed_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('mfl_player_career_stats_failures')
    .upsert(failureRows, { onConflict: 'player_id' });

  if (error) {
    throw new Error(`Failed to save failure rows: ${error.message}`);
  }
}

async function getCount(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.warn(`Could not get count for ${table}: ${error.message}`);
    return null;
  }

  return count;
}

async function main() {
  console.log('Starting MFL career stats sync...');
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Request delay: ${REQUEST_DELAY_MS}ms`);
  console.log('');

  while (true) {
    const masterCount = await getCount('mfl_players_master');
    const completedBefore = await getCount('mfl_player_career_stats');
    const rawCompletedBefore = await getCount('mfl_player_career_stats_raw');
    const failuresBefore = await getCount('mfl_player_career_stats_failures');
    const remainingBefore = await getCount('mfl_players_missing_career_stats');

    const playerIds = await fetchMissingPlayerIds();

    if (!playerIds.length) {
      console.log('No missing players found. Career stats sync complete.');
      break;
    }

    console.log(`Processing ${playerIds.length} players`);
    console.log(`Master players: ${masterCount ?? 'unknown'}`);
    console.log(`Completed before batch: ${completedBefore ?? 'unknown'}`);
    console.log(`Raw completed before batch: ${rawCompletedBefore ?? 'unknown'}`);
    console.log(`Failures before batch: ${failuresBefore ?? 'unknown'}`);
    console.log(`Remaining before batch: ${remainingBefore ?? 'unknown'}`);
    console.log(`First player in batch: ${playerIds[0]}`);
    console.log(`Last player in batch: ${playerIds[playerIds.length - 1]}`);

    let results;

    try {
      results = await mapWithConcurrency(
        playerIds,
        CONCURRENCY,
        processPlayer
      );
    } catch (err) {
      if (isStopError(err.message)) {
        console.error('');
        console.error('MFL has blocked or rate-limited the sync.');
        console.error(err.message);
        console.error('');
        console.error('No 403/429 players were saved as failures.');
        console.error('Wait 30–60 minutes, then run the script again.');
        process.exit(1);
      }

      throw err;
    }

    const successful = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);

    const rawRows = successful.map(r => r.rawRow);
    const statsRows = successful.map(r => r.statsRow);

    try {
      await upsertRows('mfl_player_career_stats_raw', rawRows);
      await upsertRows('mfl_player_career_stats', statsRows);
      await saveFailures(failed);
    } catch (err) {
      console.error('');
      console.error('Database save failed.');
      console.error(err.message);
      console.error('');
      console.error('The same batch may repeat because rows were not written.');
      console.error('Paste this full error back into ChatGPT.');
      process.exit(1);
    }

    console.log(`Saved successful players: ${successful.length}`);

    if (failed.length) {
      console.log(`Saved failed players: ${failed.length}`);
      for (const fail of failed.slice(0, 10)) {
        console.log(`- Player ${fail.playerId}: ${fail.error}`);
      }
    }

    const completedAfter = await getCount('mfl_player_career_stats');
    const rawCompletedAfter = await getCount('mfl_player_career_stats_raw');
    const failuresAfter = await getCount('mfl_player_career_stats_failures');
    const remainingAfter = await getCount('mfl_players_missing_career_stats');

    console.log(`Completed after batch: ${completedAfter ?? 'unknown'}`);
    console.log(`Raw completed after batch: ${rawCompletedAfter ?? 'unknown'}`);
    console.log(`Failures after batch: ${failuresAfter ?? 'unknown'}`);
    console.log(`Remaining after batch: ${remainingAfter ?? 'unknown'}`);
    console.log('---');
  }

  console.log('Finished.');
}

main().catch(err => {
  console.error('Career stats sync failed:', err);
  process.exit(1);
});