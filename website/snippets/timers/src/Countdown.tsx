import { useTable, useServerTime } from 'shoehive/react';
import type { bomb } from './game';

export function Clocks({ tableId }: { tableId: string }) {
  const { meta } = useTable<typeof bomb>(tableId);
  // Server time, re-rendered every 250 ms. It follows the server's clock, not the
  // browser's, so a wrong device clock does not skew the countdown.
  const now = useServerTime();

  const turnDeadline = meta?.turn?.deadline ?? null;
  const fuseDeadline = meta?.timers.fuse ?? null;
  const secondsLeft = (deadline: number | null) =>
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  return (
    <p>
      Your turn ends in {secondsLeft(turnDeadline)}s. The fuse burns out in{' '}
      {secondsLeft(fuseDeadline)}s.
    </p>
  );
}
