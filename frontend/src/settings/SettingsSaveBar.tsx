import { AlertTriangleIcon, CheckCircleIcon } from "../components/icons";
import { StableLabel } from "../components/StableLabel";

interface SettingsSaveBarProps {
  saving: boolean;
  dirty: boolean;
  success: boolean;
  error: string | null;
  onSave: () => void;
  /** Extra condition (e.g. a validation failure) that should also block
   * saving, beyond the standard saving/unchanged checks. */
  disabled?: boolean;
  label?: string;
}

/**
 * The Save control + inline result state shared by every editable Settings
 * section (Profile, Work & pay, Weekly goals) — one consistent place for
 * "disabled while saving," "disabled when nothing changed," and the
 * success/error banners, instead of each section reimplementing its own
 * version. Success and error are never conveyed by color alone: each pairs
 * an icon with real text.
 */
export function SettingsSaveBar({ saving, dirty, success, error, onSave, disabled = false, label = "Save changes" }: SettingsSaveBarProps) {
  return (
    <div className="settings-savebar">
      {error && (
        <div className="banner banner-danger" role="alert">
          <AlertTriangleIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      {success && !error && (
        <div className="banner banner-success" role="status">
          <CheckCircleIcon size={16} />
          <span>Saved</span>
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !dirty || disabled}>
        <StableLabel current={saving ? "Saving…" : label} longest={label.length >= "Saving…".length ? label : "Saving…"} />
      </button>
    </div>
  );
}
