import { useId, useRef, useState } from "react";
import type { WorkLocation } from "../lib/types";
import { fmt2 } from "../lib/date";
import { CURRENCY } from "../context/AppContext";
import { CheckIcon, CloseIcon, FuelIcon, LocationPinIcon, SettingsIcon } from "./icons";
import { Overlay } from "./Overlay";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";

interface WorkLocationPickerProps {
  title: string;
  locations: WorkLocation[];
  selectedId: string | null;
  historicalSelection?: Pick<WorkLocation, "id" | "name" | "address" | "fuelAllowance"> | null;
  onSelect: (locationId: string) => boolean | void | Promise<boolean | void>;
  onManageLocations: () => void;
  onClose: () => void;
}

function allowanceLabel(amount: number | null): string {
  return amount == null
    ? "No automatic fuel allowance"
    : `${CURRENCY}${fmt2(amount)} fuel allowance per worked day`;
}

/**
 * Responsive work-location chooser. It is a bottom sheet on phones and a
 * compact dialog on larger screens, with enough context to choose a branch
 * without relying on a truncated native select option.
 */
export function WorkLocationPicker({
  title,
  locations,
  selectedId,
  historicalSelection,
  onSelect,
  onManageLocations,
  onClose,
}: WorkLocationPickerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const { closing, requestClose } = useDismissTransition(180);
  const dismiss = () => requestClose(onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, dismiss, selectedId ? selectedButtonRef : closeButtonRef);

  async function choose(locationId: string) {
    if (locationId === selectedId) {
      dismiss();
      return;
    }
    setSelectingId(locationId);
    try {
      const accepted = await onSelect(locationId);
      if (accepted !== false) dismiss();
    } finally {
      setSelectingId(null);
    }
  }

  function manage() {
    requestClose(onManageLocations);
  }

  const selectedIsArchived = !!historicalSelection && !locations.some((location) => location.id === historicalSelection.id);

  return (
    <Overlay>
      <div
        className={`location-picker-backdrop${closing ? " is-closing" : ""}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) dismiss();
        }}
      >
        <div
          ref={dialogRef}
          className={`location-picker-sheet${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
        >
          <div className="location-picker-handle" aria-hidden="true" />
          <header className="location-picker-header">
            <div className="location-picker-heading">
              <span className="location-picker-heading-icon" aria-hidden="true"><LocationPinIcon size={20} /></span>
              <div>
                <h2 id={titleId}>{title}</h2>
                <p id={descriptionId}>Choose the branch for this shift. Its saved fuel allowance is applied once the sign-in is saved.</p>
              </div>
            </div>
            <button ref={closeButtonRef} type="button" className="btn btn-icon btn-ghost location-picker-close" onClick={dismiss} aria-label="Close work location picker">
              <CloseIcon size={18} />
            </button>
          </header>

          <ul className="location-picker-list">
            {selectedIsArchived && historicalSelection && (
              <li className="location-picker-option is-selected is-archived">
                <span className="location-picker-option-icon" aria-hidden="true"><LocationPinIcon size={18} /></span>
                <span className="location-picker-option-content">
                  <span className="location-picker-option-title-row">
                    <strong>{historicalSelection.name}</strong>
                    <span className="location-picker-status">Archived</span>
                  </span>
                  {historicalSelection.address && <span className="location-picker-address">{historicalSelection.address}</span>}
                  <span className="location-picker-fuel"><FuelIcon size={13} /> {allowanceLabel(historicalSelection.fuelAllowance)}</span>
                  <span className="location-picker-history-note">Kept on this saved shift for accurate history.</span>
                </span>
                <span className="location-picker-check" aria-hidden="true"><CheckIcon size={17} /></span>
              </li>
            )}

            {locations.map((location) => {
              const selected = location.id === selectedId;
              const busy = selectingId === location.id;
              return (
                <li key={location.id}>
                  <button
                    ref={selected ? selectedButtonRef : undefined}
                    type="button"
                    className={`location-picker-option${selected ? " is-selected" : ""}`}
                    onClick={() => void choose(location.id)}
                    disabled={selectingId !== null}
                    aria-busy={busy || undefined}
                    aria-label={busy ? `Selecting ${location.name}…` : undefined}
                    aria-current={selected ? "true" : undefined}
                  >
                    <span className="location-picker-option-icon" aria-hidden="true"><LocationPinIcon size={18} /></span>
                    <span className="location-picker-option-content">
                      <span className="location-picker-option-title-row">
                        <strong>{location.name}</strong>
                        {selected && <span className="location-picker-status">Selected</span>}
                      </span>
                      {location.address && <span className="location-picker-address">{location.address}</span>}
                      <span className={`location-picker-fuel${location.fuelAllowance == null ? " is-empty" : ""}`}>
                        <FuelIcon size={13} /> {allowanceLabel(location.fuelAllowance)}
                      </span>
                    </span>
                    <span className="location-picker-check" aria-hidden="true">
                      {busy ? <span className="location-picker-spinner" /> : selected ? <CheckIcon size={17} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}

            {locations.length === 0 && !selectedIsArchived && (
              <li className="location-picker-empty" role="status">
                <span aria-hidden="true"><LocationPinIcon size={24} /></span>
                <strong>No work locations yet</strong>
                <span>Add a location and optional fuel allowance in Work &amp; pay settings.</span>
              </li>
            )}
          </ul>

          <footer className="location-picker-footer">
            <button type="button" className="btn btn-ghost" onClick={dismiss}>Cancel</button>
            <button type="button" className="btn btn-secondary location-picker-manage" onClick={manage}>
              <SettingsIcon size={16} /> Manage work locations
            </button>
          </footer>
        </div>
      </div>
    </Overlay>
  );
}
