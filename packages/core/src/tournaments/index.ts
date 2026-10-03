// @touch/core/tournaments: the tournaments milestone's shared pieces (build contracts §1.11):
// the names and payload, the read contracts, the rounds validator and the score rule. Never
// re-exported from the package root (`TournamentFormat` already lives in ../protocols).
// The engine lane's lines follow: prng, americano, mexicano, regenerate, standings (plan §4).
export * from './types';
export * from './shapes';
export * from './validate';
export * from './score';
export * from './prng';
export * from './americano';
export * from './mexicano';
export * from './regenerate';
export * from './standings';
