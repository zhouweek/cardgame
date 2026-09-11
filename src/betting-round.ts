/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 单个下注轮次的动作校验、筹码变更与行动顺序推进
 */
export interface BettingPlayer { readonly id: string; readonly stack: number; readonly committed: number; readonly totalCommitted: number; readonly folded: boolean; readonly allIn: boolean; readonly actedSinceLastRaise: boolean; }
export interface BettingRound { readonly players: readonly BettingPlayer[]; readonly actorIndex: number | null; readonly currentBet: number; readonly minRaise: number; readonly complete: boolean; }
export type PlayerAction = { readonly type: 'fold' } | { readonly type: 'check' } | { readonly type: 'call' } | { readonly type: 'raiseTo'; readonly amount: number } | { readonly type: 'allIn' };
export function createBettingRound(players: readonly BettingPlayer[], firstActorIndex: number, currentBet: number, minRaise: number): BettingRound {
  validateRoundInput(players, firstActorIndex, currentBet, minRaise);
  const copied = players.map((player) => ({ ...player }));
  const actorIndex = findNextActor(copied, firstActorIndex - 1, currentBet);
  return { players: copied, actorIndex, currentBet, minRaise, complete: actorIndex === null };
}
export function applyAction(round: BettingRound, playerId: string, action: PlayerAction): BettingRound {
  if (round.complete || round.actorIndex === null) throw new Error('下注轮次已经结束');
  const actor = round.players[round.actorIndex]!; if (actor.id !== playerId) throw new Error('当前未轮到该玩家行动');
  let currentBet = round.currentBet; let minRaise = round.minRaise; let fullRaise = false;
  const players = round.players.map((player) => ({ ...player })); const player = players[round.actorIndex]!; const toCall = currentBet - player.committed;
  switch (action.type) {
    case 'fold': players[round.actorIndex] = { ...player, folded: true, actedSinceLastRaise: true }; break;
    case 'check': if (toCall !== 0) throw new Error('存在待跟注筹码时不能过牌'); players[round.actorIndex] = { ...player, actedSinceLastRaise: true }; break;
    case 'call': { if (toCall === 0) throw new Error('没有待跟注筹码时应选择过牌'); const paid = Math.min(player.stack, toCall); players[round.actorIndex] = commit(player, paid, true); break; }
    case 'raiseTo': { if (!Number.isSafeInteger(action.amount) || action.amount <= currentBet) throw new RangeError('加注目标必须高于当前下注'); const paid = action.amount - player.committed; if (paid > player.stack) throw new Error('筹码不足，请使用 All-in'); const raiseSize = action.amount - currentBet; if (raiseSize < minRaise) throw new Error('加注额低于最小加注'); if (player.actedSinceLastRaise) throw new Error('下注权尚未重新开放'); players[round.actorIndex] = commit(player, paid, true); currentBet = action.amount; minRaise = raiseSize; fullRaise = true; break; }
    case 'allIn': { if (player.stack === 0) throw new Error('玩家没有可投入的筹码'); const target = player.committed + player.stack; if (target > currentBet) { if (player.actedSinceLastRaise) throw new Error('下注权尚未重新开放'); const raiseSize = target - currentBet; if (raiseSize >= minRaise) { minRaise = raiseSize; fullRaise = true; } currentBet = target; } players[round.actorIndex] = commit(player, player.stack, true); break; }
  }
  if (fullRaise) for (let index = 0; index < players.length; index += 1) if (index !== round.actorIndex && !players[index]!.folded && !players[index]!.allIn) players[index] = { ...players[index]!, actedSinceLastRaise: false };
  const unfolded = players.filter(({ folded }) => !folded);
  const complete = unfolded.length <= 1 || players.every((candidate) => candidate.folded || candidate.allIn || (candidate.actedSinceLastRaise && candidate.committed === currentBet));
  const actorIndex = complete ? null : findNextActor(players, round.actorIndex, currentBet);
  if (!complete && actorIndex === null) throw new Error('无法找到下一位可行动玩家');
  return { players, actorIndex, currentBet, minRaise, complete };
}
function commit(player: BettingPlayer, amount: number, actedSinceLastRaise: boolean): BettingPlayer { const stack = player.stack - amount; return { ...player, stack, committed: player.committed + amount, totalCommitted: player.totalCommitted + amount, allIn: stack === 0, actedSinceLastRaise }; }
function findNextActor(players: readonly BettingPlayer[], afterIndex: number, currentBet: number): number | null { for (let offset = 1; offset <= players.length; offset += 1) { const index = (afterIndex + offset + players.length) % players.length; const player = players[index]!; if (!player.folded && !player.allIn && (!player.actedSinceLastRaise || player.committed < currentBet)) return index; } return null; }
function validateRoundInput(players: readonly BettingPlayer[], firstActorIndex: number, currentBet: number, minRaise: number): void {
  if (players.length < 2) throw new RangeError('下注轮次至少需要两名玩家');
  if (!Number.isInteger(firstActorIndex) || firstActorIndex < 0 || firstActorIndex >= players.length) throw new RangeError('首位行动玩家索引无效');
  if (!Number.isSafeInteger(currentBet) || currentBet < 0) throw new RangeError('当前下注必须是非负安全整数');
  if (!Number.isSafeInteger(minRaise) || minRaise <= 0) throw new RangeError('最小加注必须是正安全整数');
  if (new Set(players.map(({ id }) => id)).size !== players.length) throw new RangeError('玩家 ID 不能重复');
  for (const player of players) { if (!player.id) throw new TypeError('玩家 ID 不能为空'); for (const amount of [player.stack, player.committed, player.totalCommitted]) if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('玩家筹码必须是非负安全整数'); if (player.committed > player.totalCommitted) throw new RangeError('本轮下注不能超过本手累计下注'); if (player.allIn !== (player.stack === 0)) throw new Error('All-in 状态必须与剩余筹码一致'); }
}
