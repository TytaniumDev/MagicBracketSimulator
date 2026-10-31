import { GAMES_PER_CONTAINER } from '../types/simulation';
import { SliderWithInput } from './SliderWithInput';
import { Popover } from './ui/Popover';
import { GearIcon } from './ui/icons';

interface RunControlProps {
  /** The submit button's text, such as "Run simulation" or "Queue 5 pods". */
  label: string;
  disabled: boolean;
  games: number;
  onGamesChange: (games: number) => void;
  /** Pods the selection makes; above one, the settings show the total games. */
  podCount: number;
}

const MAX_GAMES = 1000;

/** The form's submit button, with a gear that opens the games-per-pod setting. */
export function RunControl({ label, disabled, games, onGamesChange, podCount }: RunControlProps) {
  return (
    <div className="flex shrink-0">
      <button
        type="submit"
        disabled={disabled}
        className="h-10 rounded-l-lg bg-accent px-4 text-sm font-semibold whitespace-nowrap text-accent-fg hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-muted"
      >
        {label}
      </button>
      <Popover
        button={<GearIcon />}
        buttonLabel="Simulation settings"
        buttonClassName="grid h-10 w-10 place-items-center rounded-r-lg border-l border-accent-fg/30 bg-accent text-accent-fg hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        panelLabel="Simulation settings"
        panelClassName="w-72"
      >
        <SliderWithInput
          label="Games per pod"
          value={games}
          onChange={onGamesChange}
          min={GAMES_PER_CONTAINER}
          max={MAX_GAMES}
          step={GAMES_PER_CONTAINER}
        />
        <p className="mt-3 text-xs text-fg-muted">
          {podCount > 1
            ? `${podCount} pods × ${games} games = ${podCount * games} games`
            : 'Each pod plays this many games.'}
        </p>
      </Popover>
    </div>
  );
}
