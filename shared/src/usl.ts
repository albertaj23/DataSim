// Universal Scalability Law helpers (engine builder replaces fitUsl with the real least-squares fit).
export interface UslParams { lambda: number; sigma: number; kappa: number }
/** X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1)) */
export const uslThroughput = (n: number, p: UslParams): number => (p.lambda * n) / (1 + p.sigma * (n - 1) + p.kappa * n * (n - 1));
