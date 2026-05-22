export const TAU = 0.5;
export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
export const SCALE = 173.7178;

export interface PlayerRating {
  rating: number;
  rd: number;
  vol: number;
}

export interface MatchOutcome {
  opponentRating: number;
  opponentRd: number;
  score: number; // 1 for win, 0.5 for draw, 0 for loss
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu: number, mu_j: number, phi_j: number): number {
  return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

export function updateRating(player: PlayerRating, matches: MatchOutcome[]): PlayerRating {
  if (matches.length === 0) {
    const phi = player.rd / SCALE;
    const phi_star = Math.sqrt(phi * phi + player.vol * player.vol);
    return {
      ...player,
      rd: phi_star * SCALE
    };
  }

  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  let v_inv = 0;
  for (const m of matches) {
    const mu_j = (m.opponentRating - 1500) / SCALE;
    const phi_j = m.opponentRd / SCALE;
    const g_j = g(phi_j);
    const e_j = E(mu, mu_j, phi_j);
    v_inv += g_j * g_j * e_j * (1 - e_j);
  }
  const v = 1 / v_inv;

  let delta_sum = 0;
  for (const m of matches) {
    const mu_j = (m.opponentRating - 1500) / SCALE;
    const phi_j = m.opponentRd / SCALE;
    const g_j = g(phi_j);
    const e_j = E(mu, mu_j, phi_j);
    delta_sum += g_j * (m.score - e_j);
  }
  const delta = v * delta_sum;

  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const e_x = Math.exp(x);
    const num = e_x * (delta * delta - phi * phi - v - e_x);
    const den = 2 * Math.pow(phi * phi + v + e_x, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  const epsilon = 0.000001;
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) {
      k++;
    }
    B = a - k * TAU;
  }

  let f_A = f(A);
  let f_B = f(B);
  while (Math.abs(B - A) > epsilon) {
    const C = A + (A - B) * f_A / (f_B - f_A);
    const f_C = f(C);
    if (f_C * f_B <= 0) {
      A = B;
      f_A = f_B;
    } else {
      f_A = f_A / 2;
    }
    B = C;
    f_B = f_C;
  }
  const sigma_prime = Math.exp(A / 2);
  const phi_star = Math.sqrt(phi * phi + sigma_prime * sigma_prime);

  const phi_prime = 1 / Math.sqrt(1 / (phi_star * phi_star) + 1 / v);
  
  let mu_prime_sum = 0;
  for (const m of matches) {
    const mu_j = (m.opponentRating - 1500) / SCALE;
    const phi_j = m.opponentRd / SCALE;
    const g_j = g(phi_j);
    const e_j = E(mu, mu_j, phi_j);
    mu_prime_sum += g_j * (m.score - e_j);
  }
  const mu_prime = mu + phi_prime * phi_prime * mu_prime_sum;

  return {
    rating: 1500 + mu_prime * SCALE,
    rd: phi_prime * SCALE,
    vol: sigma_prime
  };
}
