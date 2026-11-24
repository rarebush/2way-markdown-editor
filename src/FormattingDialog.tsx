import { useState } from "react";
import { handleDialogKeyDown } from "./dialogKeyboard";
import {
  isFormattingPreferences,
  type FormattingPreferences,
} from "./formattingPreferences";

type Props = {
  scope: "global" | "document";
  preferences: FormattingPreferences;
  globalPreferences: FormattingPreferences;
  hasOverride: boolean;
  storageError?: string;
  onClose: () => void;
  onSave: (preferences: FormattingPreferences | null) => Promise<void>;
  onReview?: () => void;
};

export function FormattingDialog({
  scope,
  preferences,
  globalPreferences,
  hasOverride,
  storageError,
  onClose,
  onSave,
  onReview,
}: Props) {
  const [values, setValues] = useState(preferences);
  const [useGlobal, setUseGlobal] = useState(!hasOverride);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isDocument = scope === "document";
  const displayed = isDocument && useGlobal ? globalPreferences : values;
  const dirty =
    (isDocument && useGlobal !== !hasOverride) ||
    ((!isDocument || !useGlobal) &&
      JSON.stringify(values) !== JSON.stringify(preferences));

  function update(key: keyof FormattingPreferences, value: string) {
    const next = { ...values, [key]: value };
    if (!isFormattingPreferences(next))
      throw new Error("Invalid formatting preference.");
    setValues(next);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(isDocument && useGlobal ? null : values);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save formatting preferences.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="dialog formatting-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formatting-title"
        onKeyDown={(event) =>
          handleDialogKeyDown(event, () => {
            if (!busy) onClose();
          })
        }
      >
        <h2 id="formatting-title">
          {isDocument ? "Document formatting" : "Formatting preferences"}
        </h2>
        <p>
          {isDocument
            ? "Choose settings for this browser-local draft, or use the global defaults."
            : "Defaults for Preview edits across documents in this browser."}
          {" "}
          Changing settings does not rewrite Markdown.
        </p>
        {isDocument && (
          <label className="formatting-checkbox">
            <input
              type="checkbox"
              autoFocus
              disabled={busy}
              checked={useGlobal}
              onChange={(event) => setUseGlobal(event.currentTarget.checked)}
            />
            Use global preferences
          </label>
        )}
        <fieldset disabled={busy || (isDocument && useGlobal)}>
          <label htmlFor="format-rule">Horizontal rules</label>
          <select
            id="format-rule"
            autoFocus={!isDocument}
            value={displayed.rule}
            onChange={(event) => update("rule", event.currentTarget.value)}
          >
            <option value="*">***</option>
            <option value="-">---</option>
            <option value="_">___</option>
          </select>
          <label htmlFor="format-bullet">Bullet lists</label>
          <select
            id="format-bullet"
            value={displayed.bullet}
            onChange={(event) => update("bullet", event.currentTarget.value)}
          >
            <option value="*">* item</option>
            <option value="-">- item</option>
            <option value="+">+ item</option>
          </select>
          <label htmlFor="format-emphasis">Emphasis and bold</label>
          <select
            id="format-emphasis"
            value={displayed.emphasis}
            onChange={(event) => update("emphasis", event.currentTarget.value)}
          >
            <option value="preserve">Preserve existing markers</option>
            <option value="*">Asterisks (* / **)</option>
            <option value="_">Underscores (_ / __)</option>
          </select>
          <label htmlFor="format-headings">Headings</label>
          <select
            id="format-headings"
            value={displayed.headings}
            onChange={(event) => update("headings", event.currentTarget.value)}
          >
            <option value="atx"># Heading</option>
            <option value="setext">Underlined headings (levels 1 and 2)</option>
          </select>
        </fieldset>
        {isDocument && (
          <p>
            Review formatting to apply these settings to the whole document.
            Unsupported Markdown may change or be lost.
          </p>
        )}
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
        <div className="dialog-actions">
          {isDocument && onReview && (
            <button
              type="button"
              className="secondary-action"
              disabled={busy || dirty}
              onClick={() => {
                try {
                  onReview();
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not review formatting.",
                  );
                }
              }}
            >
              Review formatting
            </button>
          )}
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void save()}
          >
            Save preferences
          </button>
        </div>
        {isDocument && dirty && (
          <p>Save preferences before reviewing formatting.</p>
        )}
      </section>
    </div>
  );
}
