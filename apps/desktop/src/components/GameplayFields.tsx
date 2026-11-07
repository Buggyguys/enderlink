import { Select } from "./Select";
import type { World } from "../types";
import { Field } from "./UI";
import "./GameplayFields.css";

export interface GameplayOptions {
  gamemode: string;
  difficulty: string;
  hardcore: boolean;
  pvp: boolean;
  allowCommands: boolean;
  forceGamemode: boolean;
}

export function gameplayOf(world?: World): GameplayOptions {
  return {
    gamemode: world?.gamemode ?? "survival",
    difficulty: world?.difficulty ?? "normal",
    hardcore: world?.hardcore ?? false,
    pvp: world?.pvp ?? true,
    allowCommands: world?.allowCommands ?? false,
    forceGamemode: world?.forceGamemode ?? false,
  };
}

export function GameplayFields({
  value,
  onChange,
  disabled,
  hardcoreLocked,
}: {
  value: GameplayOptions;
  onChange: (value: GameplayOptions) => void;
  disabled?: boolean;
  hardcoreLocked?: boolean;
}) {
  const patch = (update: Partial<GameplayOptions>) =>
    onChange({ ...value, ...update });
  return (
    <fieldset className="gameplay-fields" disabled={disabled}>
      <legend>How you play</legend>
      <div className="field-grid">
        <Field label="Default game mode">
          <Select
            aria-label="Default game mode"
            value={value.gamemode}
            disabled={disabled || value.hardcore}
            onValueChange={(gamemode) => patch({ gamemode })}
            options={[
              { value: "survival", label: "Survival" },
              { value: "creative", label: "Creative" },
              { value: "adventure", label: "Adventure" },
              { value: "spectator", label: "Spectator" },
            ]}
          />
        </Field>
        <Field label="Difficulty">
          <Select
            aria-label="Difficulty"
            value={value.difficulty}
            disabled={disabled || value.hardcore}
            onValueChange={(difficulty) => patch({ difficulty })}
            options={[
              { value: "peaceful", label: "Peaceful" },
              { value: "easy", label: "Easy" },
              { value: "normal", label: "Normal" },
              { value: "hard", label: "Hard" },
            ]}
          />
        </Field>
      </div>
      <label className="gameplay-option">
        <input
          type="checkbox"
          checked={value.hardcore}
          disabled={hardcoreLocked}
          onChange={(event) =>
            patch(
              event.target.checked
                ? { hardcore: true, gamemode: "survival", difficulty: "hard" }
                : { hardcore: false },
            )
          }
        />
        <span>
          <strong>Hardcore</strong>
          <small>
            Survival on Hard, with no normal respawn after death. Chosen before
            the first start.
          </small>
        </span>
      </label>
      <label className="gameplay-option">
        <input
          type="checkbox"
          checked={value.pvp}
          onChange={(event) => patch({ pvp: event.target.checked })}
        />
        <span>
          <strong>Player versus player</strong>
          <small>Players can damage each other.</small>
        </span>
      </label>
      <label className="gameplay-option">
        <input
          type="checkbox"
          checked={value.forceGamemode}
          onChange={(event) => patch({ forceGamemode: event.target.checked })}
        />
        <span>
          <strong>Apply game mode on every join</strong>
          <small>
            Off: returning players keep their last mode. On: everyone joins in
            the default mode above.
          </small>
        </span>
      </label>
      <label className="gameplay-option">
        <input
          type="checkbox"
          checked={value.allowCommands}
          onChange={(event) => patch({ allowCommands: event.target.checked })}
        />
        <span>
          <strong>Allow player commands (cheats)</strong>
          <small>
            Enable commands such as /gamemode and /give for players you choose
            in Manage access. No one receives permission automatically.
          </small>
        </span>
      </label>
    </fieldset>
  );
}
